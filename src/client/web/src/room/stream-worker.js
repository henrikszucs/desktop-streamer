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
//      {type: "reset"}                              the stream is over, the picture stays
//      {type: "close"}                              the worker is done
// Out: {type: "need-keyframe"}                      the decoder cannot go on without one
//      {type: "size", width, height}                the picture changed size
//      {type: "stats", fps, decoded, dropped, drawer}
//      {type: "error", message}

// first-party dependencies
import { createDrawer } from "./stream-draw.js";

// how many frames may be waiting in the decoder before the ones after them are
// not worth decoding. A hardware decoder is faster than the line, so a queue
// is a hiccup and empties on its own; only one this deep - a quarter second
// at 30 fps - is the decoder falling behind for good, and then the picture
// that catches up is the next keyframe, which a dropped delta forces anyway.
const QUEUE_MAX = 8;

let drawer = null;
let canvas = null;
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

const onOutput = function(frame) {
    try {
        if (drawer !== null) {
            drawer.draw(frame);
        }
        const width = frame.displayWidth || frame.codedWidth;
        const height = frame.displayHeight || frame.codedHeight;
        if (width !== lastWidth || height !== lastHeight) {
            lastWidth = width;
            lastHeight = height;
            post({"type": "size", "width": width, "height": height});
        }
        decodedCount++;
    } catch (error) {
        post({"type": "error", "message": String(error?.message ?? error)});
    } finally {
        frame.close();
    }
};

// a decoder that errors is replaced rather than repaired: the error closes it,
// and the next keyframe is what a fresh one starts from
const onError = function(error) {
    console.error("The video decoder failed:", error);
    createDecoder();
    askKeyframe();
};

const createDecoder = function() {
    try {
        decoder?.close?.();
    } catch (error) {
        // a decoder that is already closed throws on close, and that is fine
    }
    decoder = new VideoDecoder({"output": onOutput, "error": onError});
    if (config !== null) {
        decoder.configure(config);
    }
    isWaitingKey = true;
};

const onConfig = function(next) {
    const key = JSON.stringify(next);
    if (key === configKey && decoder !== null && decoder.state === "configured") {
        return;
    }
    config = {
        "codec": next["codec"],
        "codedWidth": next["codedWidth"],
        "codedHeight": next["codedHeight"],
        "hardwareAcceleration": "prefer-hardware",
        "optimizeForLatency": true
    };
    configKey = key;
    try {
        createDecoder();
    } catch (error) {
        // the hardware path is what is preferred, not what is required
        config["hardwareAcceleration"] = "no-preference";
        createDecoder();
    }
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
    try {
        decoder?.close?.();
    } catch (error) {
        // see createDecoder
    }
    decoder = null;
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
            "drawer": drawer?.["name"] ?? ""
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
                post({"type": "error", "message": String(error?.message ?? error)});
            }
            startStats();
            break;
        case "config":
            onConfig(message["config"]);
            break;
        case "frame":
            onFrame(message);
            break;
        case "reset":
            onReset();
            break;
        case "close":
            onReset();
            clearInterval(statsTimerId);
            drawer?.close?.();
            drawer = null;
            self.close();
            break;
    }
});
