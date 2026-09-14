"use strict";

// the peer's decoder, off the main thread: whole frames come in from
// stream.js, a VideoDecoder turns them into pictures, and the pictures go onto
// the canvas this worker was handed - drawn the moment they decode, since the
// compositor shows what is there at the next vsync and a queue between the two
// would only be latency. Why it is a worker and what the drop rules are is
// .claude/CLIENT.md, "The stream".
//
// In:  {type: "canvas", canvas}                     the OffscreenCanvas to draw on
//      {type: "config", config}                     a decoder configuration
//      {type: "frame", data, isKey, timestamp}      one whole encoded frame
//      {type: "enhance", options}                   which enhancements to run (./stream-enhance.js)
//      {type: "reset"}                              the stream is over, the picture stays
//      {type: "close"}                              the worker is done
// Out: {type: "need-keyframe"}                      the decoder cannot go on without one
//      {type: "size", width, height}                the picture changed size
//      {type: "stats", fps, decoded, dropped, drawer, enhance}
//      {type: "enhance", backend, options, error}   what the enhancer can do and is doing
//      {type: "error", message}

// first-party dependencies
import { createDrawer } from "./stream-draw.js";
import { OFF, isAnyOn, probeBackend, createEnhancer } from "./stream-enhance.js";

// how many frames may be waiting in the decoder before the ones after them are
// not worth decoding. A hardware decoder is faster than the line, so a queue
// is a hiccup and empties on its own; only one this deep - a quarter second
// at 30 fps - is the decoder falling behind for good, and then the picture
// that catches up is the next keyframe, which a dropped delta forces anyway.
const QUEUE_MAX = 8;

let drawer = null;
let canvas = null;
let enhancer = null;        // made on the first enhancement turned on, kept after
let enhanceBackend = "";    // "webgpu", "webgl", or "" for a browser with neither
let enhanceQueue = Promise.resolve();   // one enhance message at a time
let decoder = null;
let config = null;
let configKey = "";         // the config as JSON, so the same one is not applied twice
let isWaitingKey = true;    // nothing but a keyframe can start or restart the picture
let isKeyAsked = false;     // one request per gap, not one per frame
let lastWidth = 0;
let lastHeight = 0;

// counted between two stats messages
let decodedCount = 0;
let droppedCount = 0;
let statsTimerId = -1;

const post = function(message) {
    self.postMessage(message);
};

const askKeyframe = function() {
    isWaitingKey = true;
    if (isKeyAsked === true) {
        return;
    }
    isKeyAsked = true;
    post({"type": "need-keyframe"});
};

// a picture onto the canvas - a decoded frame, or one the enhancer made of it
const draw = function(frame) {
    try {
        if (drawer !== null) {
            drawer.draw(frame);
        }
    } catch (error) {
        post({"type": "error", "message": String(error?.message ?? error)});
    } finally {
        frame.close();
    }
};

const onOutput = function(frame) {
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;
    if (width !== lastWidth || height !== lastHeight) {
        lastWidth = width;
        lastHeight = height;
        post({"type": "size", "width": width, "height": height});
    }
    decodedCount++;
    // the enhancer draws what it makes of the frame, in its own time; the
    // frame is its from here either way
    if (enhancer !== null) {
        enhancer.push(frame);
        return;
    }
    draw(frame);
};

//
// the enhancer
//
// Made once, on the first enhancement asked for, since making it is fetching
// the runtime. What it reports back is what the bar draws: the backend it
// has, the options in force, and the failure that turned one off.
const reportEnhance = function(error = "") {
    post({
        "type": "enhance",
        "backend": enhanceBackend,
        "options": (enhancer?.getOptions() ?? {...OFF}),
        "error": error
    });
};

const onEnhance = async function(options) {
    if (enhanceBackend === "") {
        reportEnhance(isAnyOn(options ?? {}) === true ? "unsupported" : "");
        return;
    }
    try {
        if (enhancer === null) {
            if (isAnyOn(options ?? {}) === false) {
                reportEnhance();
                return;
            }
            enhancer = await createEnhancer({
                "backend": enhanceBackend,
                "onPresent": draw,
                "onError": function(message) {
                    reportEnhance(message);
                }
            });
        }
        await enhancer.setOptions(options);
        reportEnhance();
    } catch (error) {
        console.error("The enhancer cannot start:", error);
        reportEnhance(String(error?.message ?? error));
    }
};

// a decoder that errors is replaced rather than repaired, and a configuration
// refused here (configure() reports it late, not by throwing) is retried
// without the hardware preference once - see CLIENT.md, "The stream"
const onError = function(error) {
    console.error("The video decoder failed:", error);
    if (config === null) {
        return;
    }
    if (error?.name === "NotSupportedError") {
        if (config["hardwareAcceleration"] === "no-preference") {
            closeDecoder();
            post({"type": "error", "message": "The browser cannot decode " + config["codec"]});
            return;
        }
        config["hardwareAcceleration"] = "no-preference";
    }
    createDecoder();
    askKeyframe();
};

const closeDecoder = function() {
    try {
        decoder?.close?.();
    } catch (error) {
        // a decoder that is already closed throws on close, and that is fine
    }
    decoder = null;
};

const createDecoder = function() {
    closeDecoder();
    isWaitingKey = true;
    if (config === null) {
        return;
    }
    try {
        decoder = new VideoDecoder({"output": onOutput, "error": onError});
        decoder.configure(config);
    } catch (error) {
        closeDecoder();
        post({"type": "error", "message": String(error?.message ?? error)});
    }
};

// the hardware decoder is asked about before it is asked for, since
// configure() takes any configuration and reports the refused ones to onError
const onConfig = async function(next) {
    const key = JSON.stringify(next);
    if (key === configKey && decoder !== null && decoder.state === "configured") {
        return;
    }
    configKey = key;
    const wanted = {
        "codec": next["codec"],
        "codedWidth": next["codedWidth"],
        "codedHeight": next["codedHeight"],
        "hardwareAcceleration": "prefer-hardware",
        "optimizeForLatency": true
    };
    let support = null;
    try {
        support = await VideoDecoder.isConfigSupported(wanted);
    } catch (error) {
        support = null;
    }
    if (support?.supported !== true) {
        wanted["hardwareAcceleration"] = "no-preference";
    }
    if (configKey !== key) {
        return;         // a newer configuration, or a reset, came while asking
    }
    config = wanted;
    createDecoder();
};

const onFrame = function(message) {
    if (decoder === null || decoder.state !== "configured") {
        return;
    }
    const isKey = (message["isKey"] === true);

    // a delta frame with nothing under it is garbage, and one the decoder has no
    // time for is a picture falling behind - either way the keyframe is the
    // way back, and the gap it fills is asked about once
    if (isWaitingKey === true && isKey === false) {
        droppedCount++;
        askKeyframe();
        return;
    }
    if (isKey === false && decoder.decodeQueueSize > QUEUE_MAX) {
        droppedCount++;
        askKeyframe();
        return;
    }
    if (isKey === true) {
        isWaitingKey = false;
        isKeyAsked = false;
    }
    try {
        decoder.decode(new EncodedVideoChunk({
            "type": (isKey === true ? "key" : "delta"),
            "timestamp": message["timestamp"],
            "data": message["data"]
        }));
    } catch (error) {
        console.error("Cannot decode a frame:", error);
        askKeyframe();
    }
};

const onReset = function() {
    closeDecoder();
    enhancer?.reset();
    config = null;
    configKey = "";
    isWaitingKey = true;
    isKeyAsked = false;
};

const startStats = function() {
    clearInterval(statsTimerId);
    statsTimerId = setInterval(function() {
        post({
            "type": "stats",
            "fps": decodedCount,
            "decoded": decodedCount,
            "dropped": droppedCount,
            "drawer": drawer?.["name"] ?? "",
            "enhance": (enhancer?.getStats() ?? null)
        });
        decodedCount = 0;
        droppedCount = 0;
    }, 1000);
};

self.addEventListener("message", async function(event) {
    const message = event.data ?? {};
    switch (message["type"]) {
        case "canvas":
            canvas = message["canvas"];
            try {
                drawer = await createDrawer(canvas);
            } catch (error) {
                drawer = null;
                post({"type": "error", "message": String(error?.message ?? error)});
            }
            startStats();
            // what the enhancer could run on, said before anything asks for
            // it, so the bar can grey the entry rather than let it fail
            enhanceBackend = (drawer?.["name"] === "webgpu" ? "webgpu" : await probeBackend());
            reportEnhance();
            break;
        case "config":
            onConfig(message["config"]);
            break;
        case "frame":
            onFrame(message);
            break;
        case "enhance":
            enhanceQueue = enhanceQueue.then(function() {
                return onEnhance(message["options"]);
            });
            break;
        case "reset":
            onReset();
            break;
        case "close":
            onReset();
            clearInterval(statsTimerId);
            await enhancer?.close();
            enhancer = null;
            drawer?.close?.();
            drawer = null;
            self.close();
            break;
    }
});
