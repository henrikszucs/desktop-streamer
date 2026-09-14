"use strict";

// the stream: what the two ends do with the room once it stands. The host
// captures, encodes and sends raw frames; the peer receives, decodes and draws
// them, and sends its mouse and keyboard back. Bytes over the data path on
// both legs and never a WebRTC media track - why is .claude/CLIENT.md, "The
// stream", and dev/plans/room-media.md is the plan it was built from.
//
// It follows ctx["room"] on its own: a room that connects starts the host's
// share or the peer's watch, and a room that closes stops it. What a screen
// hands in is the canvas to draw on and what the bar asked for.
//
// Over the control channel (room.send / room "message"), peer to host:
//     {"kind": "settings", "isAudio", "bandwidth", "height", "framerate", "screenIndex"}
//     {"kind": "keyframe"}
//     {"kind": "control", "isControl"}
//     {"kind": "input", "events": [...]}          see stream-input.js
// and host to peer:
//     {"kind": "share", "width", "height", "isAudio", "isControl", "screens", "screenIndex"}
//     {"kind": "share-end"}
// `screens` is the host's displays as it lists them ({width, height,
// isPrimary} each, in the order a screenIndex names them) - empty for a web
// host, whose picker chose - and `screenIndex` the one the picture is of.
// Over the video channel (room.sendFrame / room "frame"): frame.js chunks.

// first-party dependencies
import { HEADER_SIZE, FLAG_KEY, FLAG_AUDIO, FLAG_CONFIG, packFrame, packConfig, readConfig, createReassembler } from "./frame.js";
import { buildLines, CODEC } from "./stream-ffmpeg.js";
import { createInput } from "./stream-input.js";

// what the host runs at before the peer says anything: the room bar's own
// defaults, so the first frames are what the bar shows. No screenIndex: the
// primary display until the peer names another.
const DEFAULT_SETTINGS = {"isAudio": true, "bandwidth": 8, "height": 1080, "framerate": 30};

// the display a peer may ask for: an index into the host's list, or nothing
// for the primary one - anything else is read as nothing
const screenIndexOf = function(value) {
    return (Number.isInteger(value) && value >= 0 ? value : undefined);
};

// the frame rates a peer may ask for, and the rate anything else is read as
const FRAMERATES = [24, 30, 45, 60, 120];
const framerateOf = function(value) {
    const wanted = Number(value);
    return (FRAMERATES.includes(wanted) === true ? wanted : DEFAULT_SETTINGS["framerate"]);
};

// how much of the line the picture gets; the rest is the sound and the headers
const VIDEO_SHARE = 0.9;

// the web host's keyframe interval, in seconds - a WebCodecs encoder has no GOP
// of its own - and how often a keyframe may be asked for, whoever asks
const KEY_INTERVAL = 2;
const KEY_REQUEST_GAP = 1000;

// a settings change restarts the desktop encoder, so several in a row are one
const RESTART_DEBOUNCE = 500;

// how long an ffmpeg line is given to produce its first frame before the next
// line is tried
const ENCODER_START_TIMEOUT = 6000;

// the sound: Opus at what every browser encodes it at, and how far ahead of
// the clock a frame is scheduled so the next one is there before it is due
const AUDIO_CODEC = "opus";
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_JITTER = 0.06;

// how many frames the web encoder may hold before the next is dropped rather
// than queued
const ENCODE_QUEUE_MAX = 2;

//
// the peer's picture: a worker holding the decoder and the canvas
//
// A canvas hands its drawing surface over once and for good, so a viewer lives
// as long as the element and every stream drawn on it goes through the same one.
const createViewer = function(canvas, onMessage) {
    const worker = new Worker("/src/room/stream-worker.js", {"type": "module"});
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({"type": "canvas", "canvas": offscreen}, [offscreen]);
    worker.addEventListener("message", function(event) {
        onMessage(event.data ?? {});
    });
    worker.addEventListener("error", function(event) {
        console.error("The stream worker failed:", event.message);
    });
    return {
        "config": function(config) {
            worker.postMessage({"type": "config", "config": config});
        },
        "frame": function(payload, isKey, timestamp) {
            // the bytes are handed over, not copied: the reassembler made them
            // for this and holds nothing after
            const buffer = (payload.byteOffset === 0 && payload.byteLength === payload.buffer.byteLength
                ? payload.buffer
                : payload.slice().buffer);
            worker.postMessage({"type": "frame", "data": buffer, "isKey": isKey, "timestamp": timestamp}, [buffer]);
        },
        "enhance": function(options) {
            worker.postMessage({"type": "enhance", "options": options});
        },
        "reset": function() {
            worker.postMessage({"type": "reset"});
        },
        "close": function() {
            worker.postMessage({"type": "close"});
        }
    };
};

//
// the peer's sound: decoded here, since a worker has no speaker
//
const createAudioPlayer = function() {
    let context = null;
    let gain = null;
    let decoder = null;
    let configKey = "";
    let nextTime = 0;
    let isMuted = false;

    const ensureContext = function() {
        if (context !== null) {
            return;
        }
        context = new AudioContext({"sampleRate": AUDIO_SAMPLE_RATE, "latencyHint": "interactive"});
        gain = context.createGain();
        gain.gain.value = (isMuted === true ? 0 : 1);
        gain.connect(context.destination);
        nextTime = 0;
    };

    // one decoded frame onto the clock: the first is scheduled a jitter's worth
    // ahead, each one after is put right behind the one before it, and one
    // that would land in the past starts the clock over rather than stacking
    // late frames behind each other
    const onOutput = function(frame) {
        try {
            const buffer = context.createBuffer(frame.numberOfChannels, frame.numberOfFrames, frame.sampleRate);
            for (let channel = 0; channel < frame.numberOfChannels; channel++) {
                const data = new Float32Array(frame.numberOfFrames);
                frame.copyTo(data, {"planeIndex": channel, "format": "f32-planar"});
                buffer.copyToChannel(data, channel);
            }
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(gain);
            const now = context.currentTime;
            if (nextTime < now) {
                nextTime = now + AUDIO_JITTER;
            }
            source.start(nextTime);
            nextTime += buffer.duration;
        } catch (error) {
            console.error("Cannot play a sound frame:", error);
        } finally {
            frame.close();
        }
    };

    const createDecoder = function(config) {
        try {
            decoder?.close?.();
        } catch (error) {
            // already closed
        }
        decoder = new AudioDecoder({
            "output": onOutput,
            "error": function(error) {
                console.error("The audio decoder failed:", error);
                decoder = null;
                configKey = "";
            }
        });
        decoder.configure(config);
    };

    return {
        "config": function(config) {
            if (typeof AudioDecoder === "undefined") {
                return;
            }
            const key = JSON.stringify(config);
            if (key === configKey && decoder !== null && decoder.state === "configured") {
                return;
            }
            ensureContext();
            configKey = key;
            createDecoder({
                "codec": config["codec"] ?? AUDIO_CODEC,
                "sampleRate": config["sampleRate"] ?? AUDIO_SAMPLE_RATE,
                "numberOfChannels": config["numberOfChannels"] ?? 2
            });
        },
        "frame": function(payload, timestamp) {
            if (decoder === null || decoder.state !== "configured") {
                return;
            }
            if (context.state === "suspended") {
                context.resume();
            }
            try {
                decoder.decode(new EncodedAudioChunk({"type": "key", "timestamp": timestamp, "data": payload}));
            } catch (error) {
                console.error("Cannot decode a sound frame:", error);
            }
        },
        "setMuted": function(value) {
            isMuted = (value === true);
            if (gain !== null) {
                gain.gain.value = (isMuted === true ? 0 : 1);
            }
        },
        "reset": function() {
            try {
                decoder?.close?.();
            } catch (error) {
                // already closed
            }
            decoder = null;
            configKey = "";
            nextTime = 0;
        },
        "close": function() {
            this.reset();
            context?.close?.();
            context = null;
            gain = null;
        }
    };
};

//
// the desktop host's encoder: ffmpeg, the first line that works
//
// {start(settings), stop(), setSettings(settings), requestKeyframe(), onChunk, onConfig, onEnd}
const createDesktopEncoder = function(ctx) {
    const desktop = ctx["desktop"];
    let encoder = null;
    let settings = null;
    let restartId = -1;
    let generation = 0;

    // the callbacks the stream fills in, on the object it is handed back
    const api = {
        "onChunk": function() {},
        "onConfig": function() {},
        "onAudioChunk": function() {},
        "onAudioConfig": function() {},
        "onEnd": function() {}
    };

    // the displays as easy-control lists them, in the words the peer is told
    const listScreens = function() {
        return desktop["Control"]["Screen"].list().map(function(screen) {
            return {"width": screen["width"], "height": screen["height"], "isPrimary": screen["isPrimary"] === true};
        });
    };

    // the display shared, as easy-control lists them: the one asked for, or
    // the primary one
    const screenOf = function(wantedIndex) {
        const screens = desktop["Control"]["Screen"].list();
        let index = (Number.isInteger(wantedIndex) && wantedIndex >= 0 && wantedIndex < screens.length
            ? wantedIndex
            : screens.findIndex(function(screen) {
                return screen["isPrimary"] === true;
            }));
        if (index < 0) {
            index = 0;
        }
        const screen = screens[index] ?? {"width": 1920, "height": 1080, "x": 0, "y": 0, "scaleFactor": 1};
        return {...screen, "index": index};
    };

    const startLine = function(line) {
        return new Promise(function(resolve, reject) {
            const attempt = new desktop["FFmpegVideoEncoder"]();
            const timeoutId = setTimeout(function() {
                attempt.kill();
                reject(new Error(line["name"] + " produced nothing in time"));
            }, ENCODER_START_TIMEOUT);
            // whatever the line cuts before it is adopted is kept: the first
            // unit is the keyframe everything after it stands on
            attempt.pending = [];
            attempt.onChunk = function(chunk) {
                attempt.pending.push(chunk);
            };
            attempt.onEnd = function() {};
            attempt.start(desktop["ffmpegPath"], line["params"]).then(function() {
                clearTimeout(timeoutId);
                resolve(attempt);
            }, function(error) {
                clearTimeout(timeoutId);
                reject(error);
            });
        });
    };

    const start = async function(wanted) {
        settings = {...wanted};
        const own = ++generation;
        const screen = screenOf(settings["screenIndex"]);
        api.screen = screen;
        api.screens = listScreens();
        const built = buildLines(desktop["os"].platform(), screen, {
            "bitrate": settings["bandwidth"] * 1000000 * VIDEO_SHARE,
            "height": settings["height"],
            "framerate": settings["framerate"]
        });

        let started = null;
        let lastError = null;
        for (const line of built["lines"]) {
            try {
                started = await startLine(line);
                console.log("Stream encoder: " + line["name"]);
                break;
            } catch (error) {
                lastError = error;
                console.warn("Stream encoder " + line["name"] + " did not start:", error?.message ?? error);
            }
        }
        if (own !== generation) {
            started?.end?.();       // a newer start has taken over meanwhile
            return;
        }
        if (started === null) {
            throw (lastError ?? new Error("No encoder started"));
        }
        encoder = started;
        api.onConfig({"codec": built["codec"], "codedWidth": built["size"]["width"], "codedHeight": built["size"]["height"]});
        encoder.onChunk = function(chunk) {
            api.onChunk(chunk);
        };
        for (const chunk of started.pending) {
            api.onChunk(chunk);
        }
        started.pending = [];
        encoder.onEnd = function(error) {
            if (encoder !== started) {
                return;
            }
            encoder = null;
            api.onEnd(error);
        };
    };

    const stop = async function() {
        generation++;
        clearTimeout(restartId);
        restartId = -1;
        const running = encoder;
        encoder = null;
        if (running !== null) {
            running.onEnd = function() {};
            await running.end();
        }
    };

    return Object.assign(api, {
        "start": start,
        "stop": stop,

        // ffmpeg is told nothing while it runs, so a change is a restart - held
        // for a moment, since a bar being dragged is many changes
        "setSettings": function(wanted) {
            if (settings === null) {
                return;
            }
            if (wanted["bandwidth"] === settings["bandwidth"] && wanted["height"] === settings["height"]
                && wanted["framerate"] === settings["framerate"] && wanted["screenIndex"] === settings["screenIndex"]) {
                return;
            }
            settings = {...wanted};
            clearTimeout(restartId);
            restartId = setTimeout(async function() {
                restartId = -1;
                const own = generation;
                const running = encoder;
                encoder = null;
                if (running !== null) {
                    running.onEnd = function() {};
                    await running.end();
                }
                if (own !== generation) {
                    return;         // stopped while the old line was ending
                }
                try {
                    await start(settings);
                } catch (error) {
                    api.onEnd(error);
                }
            }, RESTART_DEBOUNCE);
        },

        // a keyframe every second is the whole answer here: ffmpeg cannot be
        // asked for one over a pipe, and the second is what a gap costs
        "requestKeyframe": function() {},

        "hasAudio": function() {
            return false;
        }
    });
};

//
// the web host's encoder: the screen picker and WebCodecs
//
const isWebEncoderSupported = function() {
    return typeof VideoEncoder !== "undefined" && typeof MediaStreamTrackProcessor !== "undefined"
        && typeof navigator.mediaDevices?.getDisplayMedia === "function";
};

const createWebEncoder = function() {
    let stream = null;
    let videoEncoder = null;
    let audioEncoder = null;
    let isRunning = false;
    let frameCount = 0;
    let isKeyWanted = false;
    let settings = null;
    let size = null;
    let generation = 0;
    const api = {
        "onChunk": function() {},
        "onConfig": function() {},
        "onAudioChunk": function() {},
        "onAudioConfig": function() {},
        "onEnd": function() {}
    };

    // the picture the peer asked for, no larger than the one captured
    const sizeOf = function(track, height) {
        const captured = track.getSettings();
        const width = captured["width"] ?? 1920;
        const captureHeight = captured["height"] ?? 1080;
        const outHeight = Math.max(2, Math.round(Math.min(height, captureHeight) / 2) * 2);
        const outWidth = Math.max(2, Math.round(outHeight * width / captureHeight / 2) * 2);
        return {"width": outWidth, "height": outHeight};
    };

    const videoConfig = function(track) {
        size = sizeOf(track, settings["height"]);
        return {
            "codec": CODEC,
            "width": size["width"],
            "height": size["height"],
            "bitrate": Math.round(settings["bandwidth"] * 1000000 * VIDEO_SHARE),
            "framerate": settings["framerate"],
            "latencyMode": "realtime",
            "hardwareAcceleration": "no-preference",
            "avc": {"format": "annexb"}
        };
    };

    const configureVideo = async function(track) {
        const config = videoConfig(track);
        const support = await VideoEncoder.isConfigSupported(config);
        if (support?.supported !== true) {
            throw new Error("The browser cannot encode " + config["codec"] + " at " + config["width"] + "x" + config["height"]);
        }
        if (videoEncoder === null || videoEncoder.state === "closed") {
            return;             // stopped while the question was out
        }
        videoEncoder.configure(config);
        api.onConfig({"codec": CODEC, "codedWidth": size["width"], "codedHeight": size["height"]});
        isKeyWanted = true;
    };

    const readVideo = async function(track) {
        const reader = new MediaStreamTrackProcessor({"track": track}).readable.getReader();
        let lastTimestamp = -Infinity;
        try {
            while (isRunning === true) {
                const {value, done} = await reader.read();
                if (done === true || isRunning === false) {
                    value?.close?.();
                    break;
                }
                // the rate is the bar's, whatever the capture runs at: the
                // track was asked for it, but a display that captures faster
                // than it was asked is paced here rather than encoded whole -
                // a hair under the interval, so a capture at exactly the rate
                // is never skipped for arriving early
                const interval = 1000000 / settings["framerate"] * 0.95;
                if (videoEncoder.state !== "configured" || videoEncoder.encodeQueueSize > ENCODE_QUEUE_MAX
                    || value.timestamp - lastTimestamp < interval) {
                    value.close();
                    continue;
                }
                lastTimestamp = value.timestamp;
                const isKey = (isKeyWanted === true || frameCount % (KEY_INTERVAL * settings["framerate"]) === 0);
                isKeyWanted = false;
                frameCount++;
                videoEncoder.encode(value, {"keyFrame": isKey});
                value.close();
            }
        } catch (error) {
            console.error("The screen reader failed:", error);
        } finally {
            reader.releaseLock?.();
            if (isRunning === true) {
                api.onEnd(0);
            }
        }
    };

    const readAudio = async function(track) {
        if (typeof AudioEncoder === "undefined") {
            return;
        }
        audioEncoder = new AudioEncoder({
            "output": function(chunk, metadata) {
                if (typeof metadata?.decoderConfig !== "undefined") {
                    api.onAudioConfig({
                        "codec": AUDIO_CODEC,
                        "sampleRate": metadata.decoderConfig["sampleRate"],
                        "numberOfChannels": metadata.decoderConfig["numberOfChannels"]
                    });
                }
                api.onAudioChunk(chunk);
            },
            "error": function(error) {
                console.error("The audio encoder failed:", error);
            }
        });
        const captured = track.getSettings();
        audioEncoder.configure({
            "codec": AUDIO_CODEC,
            "sampleRate": AUDIO_SAMPLE_RATE,
            "numberOfChannels": captured["channelCount"] ?? 2,
            "bitrate": 96000
        });
        const reader = new MediaStreamTrackProcessor({"track": track}).readable.getReader();
        try {
            while (isRunning === true) {
                const {value, done} = await reader.read();
                if (done === true || isRunning === false) {
                    value?.close?.();
                    break;
                }
                if (audioEncoder.state === "configured" && settings["isAudio"] !== false) {
                    audioEncoder.encode(value);
                }
                value.close();
            }
        } catch (error) {
            console.error("The sound reader failed:", error);
        } finally {
            reader.releaseLock?.();
        }
    };

    return Object.assign(api, {
        "start": async function(wanted) {
            if (isWebEncoderSupported() === false) {
                throw new Error("This browser cannot share its screen");
            }
            settings = {...wanted};
            const own = ++generation;
            const picked = await navigator.mediaDevices.getDisplayMedia({
                "video": {"frameRate": {"ideal": wanted["framerate"]}, "cursor": "always"},
                "audio": true,
                "systemAudio": "include",
                "preferCurrentTab": false
            });
            // a stop while the picker was open: what was picked is let go,
            // since nothing is left to send it to
            if (own !== generation) {
                for (const track of picked.getTracks()) {
                    track.stop();
                }
                return;
            }
            stream = picked;
            const videoTrack = stream.getVideoTracks()[0];
            if (typeof videoTrack === "undefined") {
                throw new Error("No screen was picked");
            }
            isRunning = true;
            frameCount = 0;
            videoEncoder = new VideoEncoder({
                "output": function(chunk) {
                    const data = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(data);
                    api.onChunk({"data": data, "isKey": chunk.type === "key", "timestamp": chunk.timestamp});
                },
                "error": function(error) {
                    console.error("The video encoder failed:", error);
                    api.onEnd(1);
                }
            });
            await configureVideo(videoTrack);
            if (own !== generation) {
                return;
            }

            // the picker's own stop button ends the share like anything else
            videoTrack.addEventListener("ended", function() {
                if (isRunning === true) {
                    api.onEnd(0);
                }
            });
            readVideo(videoTrack);
            const audioTrack = stream.getAudioTracks()[0];
            if (typeof audioTrack !== "undefined") {
                readAudio(audioTrack);
            }
        },
        "stop": async function() {
            generation++;
            isRunning = false;
            for (const track of stream?.getTracks?.() ?? []) {
                track.stop();
            }
            stream = null;
            try {
                if (videoEncoder !== null && videoEncoder.state !== "closed") {
                    videoEncoder.close();
                }
                if (audioEncoder !== null && audioEncoder.state !== "closed") {
                    audioEncoder.close();
                }
            } catch (error) {
                // closing a closed encoder is nothing
            }
            videoEncoder = null;
            audioEncoder = null;
        },
        "setSettings": async function(wanted) {
            if (settings === null || videoEncoder === null || stream === null) {
                return;
            }
            const isChanged = (wanted["bandwidth"] !== settings["bandwidth"] || wanted["height"] !== settings["height"]
                || wanted["framerate"] !== settings["framerate"]);
            const isRateChanged = (wanted["framerate"] !== settings["framerate"]);
            settings = {...wanted};
            if (isChanged === false) {
                return;
            }
            const track = stream.getVideoTracks()[0];
            try {
                // the capture is what paces the encoder, so the rate is asked of
                // the track first; a display that cannot do it gives what it can
                if (isRateChanged === true) {
                    await track.applyConstraints({"frameRate": {"ideal": settings["framerate"]}});
                }
            } catch (error) {
                console.warn("The display did not take the frame rate:", error);
            }
            try {
                await configureVideo(track);
            } catch (error) {
                console.error("Cannot reconfigure the encoder:", error);
            }
        },
        "requestKeyframe": function() {
            isKeyWanted = true;
        },
        // whether the display picked shares its sound. Asked of the stream and
        // not of the encoder: the share message goes out on the video
        // configuration, which is before the audio encoder exists
        "hasAudio": function() {
            return (stream?.getAudioTracks?.() ?? []).length > 0;
        }
    });
};

//
// the host's hands: the peer's events applied with easy-control
//
const createControl = function(ctx) {
    const control = ctx["desktop"]?.["Control"];
    let screen = null;
    const downButtons = new Set();
    const downKeys = new Set();

    const apply = function(event) {
        if (control === undefined || screen === null) {
            return;
        }
        const mouse = control["Mouse"];
        const keyboard = control["Keyboard"];
        switch (event["t"]) {
            case "move":
                mouse.setX(Math.round(screen["x"] + event["x"] * screen["width"]));
                mouse.setY(Math.round(screen["y"] + event["y"] * screen["height"]));
                break;
            case "down":
                mouse.buttonDown(event["b"]);
                downButtons.add(event["b"]);
                break;
            case "up":
                mouse.buttonUp(event["b"]);
                downButtons.delete(event["b"]);
                break;
            case "scroll": {
                const y = Number(event["y"]) || 0;
                const x = Number(event["x"]) || 0;
                if (y > 0) {
                    mouse.scrollDown(Math.max(1, Math.round(y)), false);
                } else if (y < 0) {
                    mouse.scrollUp(Math.max(1, Math.round(-y)), false);
                }
                if (x > 0) {
                    mouse.scrollDown(Math.max(1, Math.round(x)), true);
                } else if (x < 0) {
                    mouse.scrollUp(Math.max(1, Math.round(-x)), true);
                }
                break;
            }
            case "key":
                if (typeof event["c"] !== "string" || keyboard.isKeySupported(event["c"]) !== true) {
                    break;
                }
                if (event["d"] === true) {
                    keyboard.keyDown(event["c"]);
                    downKeys.add(event["c"]);
                } else {
                    keyboard.keyUp(event["c"]);
                    downKeys.delete(event["c"]);
                }
                break;
        }
    };

    return {
        "isAvailable": function() {
            return control !== undefined;
        },
        "start": function(sharedScreen) {
            screen = sharedScreen;
        },
        "apply": function(events) {
            if (Array.isArray(events) === false) {
                return;
            }
            for (const event of events) {
                try {
                    apply(event);
                } catch (error) {
                    console.error("Cannot apply an input event:", error);
                }
            }
        },
        // a peer that lets go leaves nothing pressed behind it
        "release": function() {
            try {
                for (const button of downButtons) {
                    control?.["Mouse"].buttonUp(button);
                }
                for (const code of downKeys) {
                    control?.["Keyboard"].keyUp(code);
                }
            } catch (error) {
                // the addon is gone with the shell
            }
            downButtons.clear();
            downKeys.clear();
        },
        "stop": function() {
            this.release();
            screen = null;
        }
    };
};

//
// the module
//
const createStream = function(ctx) {
    // events: started, stopped, stats, size, control
    const events = new EventTarget();
    const emit = function(type, detail) {
        events.dispatchEvent(new CustomEvent(type, {"detail": detail}));
    };

    let role = "";                  // "" | host | peer | preview
    let encoder = null;             // the host's
    let control = null;             // the host's hands
    let seq = 0;
    let videoConfig = null;
    let audioConfig = null;
    let lastKeyRequest = 0;
    let statsTimerId = -1;

    // what the peer asked for, or what it will be asked for
    let settings = {...DEFAULT_SETTINGS};
    let isControlWanted = false;

    // and what it asked of its own picture: the enhancements the worker runs
    // (src/room/stream-enhance.js) - kept here, since they are this viewer's
    // and never the host's - and what the worker last said of them
    let enhanceWanted = {"upscale": false, "interpolate": false, "extrapolate": false};
    let enhanceState = {"backend": "", "isKnown": false, "options": {...enhanceWanted}};

    // the peer's side
    let canvas = null;
    let viewer = null;              // the worker over the room's canvas
    let previewViewer = null;       // and over the preview's, when there is one
    let audioPlayer = null;
    let input = null;
    let reassembler = null;
    let hostInfo = null;            // the host's "share" message, when it came

    // counted between two stats events
    let sentBytes = 0;
    let sentFrames = 0;
    let droppedFrames = 0;
    let receivedBytes = 0;
    let workerStats = null;

    const room = function() {
        return ctx["room"];
    };

    const say = function(message) {
        room().send(message).catch?.(function(error) {
            console.error("Cannot send on the control channel:", error);
        });
    };

    //
    // sending frames, both hosts
    //
    const sendUnit = function(flags, timestamp, payload) {
        const limit = room().getFrameLimit();
        const chunkSize = (Number.isFinite(limit) === true ? limit - HEADER_SIZE : Infinity);
        const chunks = packFrame(seq++, flags, timestamp, payload, chunkSize);
        for (const chunk of chunks) {
            if (room().sendFrame(chunk) === false) {
                droppedFrames++;
                return false;
            }
            sentBytes += chunk.byteLength;
        }
        sentFrames++;
        return true;
    };

    const onVideoChunk = function(chunk) {
        if (role === "preview") {
            if (previewViewer !== null) {
                previewViewer.frame(chunk["data"], chunk["isKey"], chunk["timestamp"]);
            }
            return;
        }
        if (role !== "host" || room().isConnected() === false) {
            return;
        }
        // the configuration rides ahead of every keyframe, so a peer that
        // missed it once has it the next time it could use it
        if (chunk["isKey"] === true && videoConfig !== null) {
            sendUnit(FLAG_CONFIG, chunk["timestamp"], packConfig(videoConfig));
        }
        const isSent = sendUnit((chunk["isKey"] === true ? FLAG_KEY : 0), chunk["timestamp"], chunk["data"]);
        if (isSent === false && chunk["isKey"] === true) {
            encoder?.requestKeyframe?.();
        }
    };

    const onAudioChunk = function(chunk) {
        if (role !== "host" || room().isConnected() === false || settings["isAudio"] === false) {
            return;
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        sendUnit(FLAG_AUDIO, chunk.timestamp, data);
    };

    //
    // the host
    //
    // what the host is sharing, for the peer's bar: the picture, and whether
    // there is sound and a keyboard to take with it - a button for what the
    // host has not got is greyed rather than left to do nothing
    const shareMessage = function() {
        return {
            "kind": "share",
            ...hostInfo,
            "isAudio": encoder?.hasAudio?.() === true,
            "isControl": control?.isAvailable() === true
        };
    };

    const startHost = async function() {
        if (role !== "") {
            await stop();
        }
        role = "host";
        seq = 0;
        videoConfig = null;
        audioConfig = null;
        const desktop = ctx["desktop"];
        encoder = (desktop.isAvailable === true ? createDesktopEncoder(ctx) : createWebEncoder());
        // every start of the encoder - the first and each restart - says what
        // it is showing: the picture, and which of the host's displays it is
        // of, so the peer's bar can offer the others. The control follows it,
        // since the mouse is mapped into the display being shared.
        encoder.onConfig = function(config) {
            videoConfig = config;
            hostInfo = {
                "width": config["codedWidth"],
                "height": config["codedHeight"],
                "screens": encoder?.screens ?? [],
                "screenIndex": encoder?.screen?.["index"]
            };
            if (desktop.isAvailable === true && typeof encoder?.screen !== "undefined") {
                control?.start(encoder.screen);
            }
            if (room().isConnected() === true) {
                say(shareMessage());
            }
        };
        encoder.onChunk = onVideoChunk;
        encoder.onAudioConfig = function(config) {
            audioConfig = config;
            sendUnit(FLAG_CONFIG | FLAG_AUDIO, 0, packConfig(config));
        };
        encoder.onAudioChunk = onAudioChunk;
        encoder.onEnd = function(error) {
            console.log("The share ended" + (error ? " (" + error + ")" : ""));
            stop("ended");
        };

        control = createControl(ctx);
        try {
            await encoder.start(settings);
            if (role !== "host") {
                return;     // stopped while the picker was open
            }
            startStats();
            emit("started", {"role": role});
        } catch (error) {
            // a host with nothing to show leaves: the peer would otherwise sit
            // on a black picture waiting for one, and the way back in is a
            // request the host can answer again
            console.error("Cannot start the share:", error);
            await stop("failed");
            emit("failed", {"role": "host", "error": String(error?.message ?? error)});
            ctx["ui"]?.snackbar?.show(ctx["localization"].get("main.share.failed"), true);
            room().leave("failed");
        }
    };

    //
    // the peer
    //
    const onFrame = function(frame) {
        const flags = frame["flags"];
        if ((flags & FLAG_CONFIG) !== 0) {
            const config = readConfig(frame["payload"]);
            if (typeof config === "undefined") {
                return;
            }
            if ((flags & FLAG_AUDIO) !== 0) {
                audioPlayer?.config(config);
            } else {
                viewer?.config(config);
            }
            return;
        }
        if ((flags & FLAG_AUDIO) !== 0) {
            audioPlayer?.frame(frame["payload"], frame["timestamp"]);
            return;
        }
        viewer?.frame(frame["payload"], (flags & FLAG_KEY) !== 0, frame["timestamp"]);
    };

    // a lost sound frame is a click and the next one is fine; a lost picture
    // frame is every frame after it until a keyframe
    const onDrop = function(drop) {
        droppedFrames++;
        if ((drop["flags"] & FLAG_AUDIO) === 0) {
            askKeyframe();
        }
    };

    // one request per gap, and never two within a second: a keyframe is the
    // costliest frame there is, and the second one changes nothing
    const askKeyframe = function() {
        const now = performance.now();
        if (now - lastKeyRequest < KEY_REQUEST_GAP) {
            return;
        }
        lastKeyRequest = now;
        say({"kind": "keyframe"});
    };

    const onWorkerMessage = function(message) {
        switch (message["type"]) {
            case "need-keyframe":
                askKeyframe();
                break;
            case "size":
                emit("size", {"width": message["width"], "height": message["height"]});
                break;
            case "stats":
                workerStats = message;
                break;
            case "enhance":
                // what the enhancer is doing is what the worker says it is:
                // an option it refused is off here too
                enhanceState = {
                    "backend": message["backend"] ?? "",
                    "isKnown": true,
                    "options": {...message["options"]}
                };
                if (message["error"] !== "") {
                    enhanceWanted = {...enhanceState["options"]};
                }
                emit("enhance", {...enhanceState, "error": message["error"] ?? ""});
                break;
            case "error":
                console.error("The stream worker reports:", message["message"]);
                break;
        }
    };

    const startPeer = async function() {
        if (role !== "") {
            await stop();
        }
        role = "peer";
        hostInfo = null;
        reassembler = createReassembler(onFrame, onDrop);
        if (audioPlayer === null) {
            audioPlayer = createAudioPlayer();
        }
        audioPlayer.setMuted(settings["isAudio"] === false);
        say({"kind": "settings", ...settings});
        if (isControlWanted === true) {
            say({"kind": "control", "isControl": true});
            input?.enable();
        }
        startStats();
        emit("started", {"role": role});
    };

    //
    // both
    //
    const startStats = function() {
        clearInterval(statsTimerId);
        statsTimerId = setInterval(function() {
            const stats = {
                "role": role,
                "mode": room().getMode(),
                "sentKbps": Math.round(sentBytes * 8 / 1000),
                "sentFrames": sentFrames,
                "receivedKbps": Math.round(receivedBytes * 8 / 1000),
                "fps": workerStats?.["fps"] ?? 0,
                "dropped": droppedFrames + (workerStats?.["dropped"] ?? 0),
                "drawer": workerStats?.["drawer"] ?? "",
                "enhance": workerStats?.["enhance"] ?? null
            };
            sentBytes = 0;
            sentFrames = 0;
            receivedBytes = 0;
            droppedFrames = 0;
            workerStats = null;
            emit("stats", stats);
        }, 1000);
    };

    const stop = async function(reason = "stopped") {
        if (role === "") {
            return;
        }
        const was = role;
        role = "";
        clearInterval(statsTimerId);
        statsTimerId = -1;

        if (was === "host" || was === "preview") {
            const running = encoder;
            encoder = null;
            control?.stop();
            control = null;
            if (running !== null) {
                running.onChunk = function() {};
                running.onAudioChunk = function() {};
                running.onEnd = function() {};
                try {
                    await running.stop();
                } catch (error) {
                    console.error("Cannot stop the encoder:", error);
                }
            }
            if (was === "host" && room().isConnected() === true) {
                say({"kind": "share-end"});
            }
            previewViewer?.reset();
        }
        if (was === "peer") {
            input?.release();
            reassembler = null;
            viewer?.reset();
            audioPlayer?.reset();
        }
        videoConfig = null;
        audioConfig = null;
        hostInfo = null;
        emit("stopped", {"role": was, "reason": reason});
    };

    //
    // what the room says
    //
    room().addEventListener("connected", function(event) {
        if (event.detail?.["isHost"] === true) {
            // a room that moved to the relay while sharing keeps sharing
            if (role === "host") {
                return;
            }
            startHost();
            return;
        }
        if (role === "peer") {
            return;
        }
        startPeer();
    });
    room().addEventListener("closed", function() {
        if (role === "host" || role === "peer") {
            stop("closed");
        }
    });
    room().addEventListener("frame", function(event) {
        if (role !== "peer" || reassembler === null) {
            return;
        }
        receivedBytes += event.detail["data"].byteLength;
        reassembler.push(event.detail["data"]);
    });
    room().addEventListener("message", function(event) {
        const message = event.detail?.["data"];
        if (typeof message !== "object" || message === null) {
            return;
        }
        if (role === "host") {
            switch (message["kind"]) {
                case "settings":
                    settings = {
                        "isAudio": message["isAudio"] !== false,
                        "bandwidth": Number(message["bandwidth"]) || DEFAULT_SETTINGS["bandwidth"],
                        "height": Number(message["height"]) || DEFAULT_SETTINGS["height"],
                        "framerate": framerateOf(message["framerate"]),
                        "screenIndex": screenIndexOf(message["screenIndex"])
                    };
                    encoder?.setSettings(settings);
                    break;
                case "keyframe":
                    encoder?.requestKeyframe();
                    break;
                case "control":
                    if (message["isControl"] !== true) {
                        control?.release();
                    }
                    break;
                case "input":
                    control?.apply(message["events"]);
                    break;
            }
            return;
        }
        if (role === "peer") {
            switch (message["kind"]) {
                case "share":
                    hostInfo = message;
                    emit("share", message);
                    break;
                case "share-end":
                    hostInfo = null;
                    viewer?.reset();
                    audioPlayer?.reset();
                    emit("share", null);
                    break;
            }
        }
    });

    return {
        "addEventListener": events.addEventListener.bind(events),
        "removeEventListener": events.removeEventListener.bind(events),

        // the canvas the room screen draws on. Once: the surface goes to the
        // worker and does not come back, so the screen keeps one element.
        "attach": function(element) {
            if (canvas === element) {
                return;
            }
            canvas = element;
            viewer = createViewer(canvas, onWorkerMessage);
            input = createInput(canvas, ctx, say, function() {
                isControlWanted = false;
                say({"kind": "control", "isControl": false});
                emit("control", {"isControl": false});
            }, function(delay) {
                emit("hold", {"delay": delay});
            });
        },

        // what the bar asked for. Sent when there is a host to send it to, and
        // kept for the next one otherwise.
        "setSettings": function(wanted) {
            settings = {
                "isAudio": wanted?.["isAudio"] !== false,
                "bandwidth": Number(wanted?.["bandwidth"]) || settings["bandwidth"],
                "height": Number(wanted?.["height"]) || settings["height"],
                "framerate": framerateOf(wanted?.["framerate"] ?? settings["framerate"]),
                "screenIndex": screenIndexOf(wanted?.["screenIndex"])
            };
            audioPlayer?.setMuted(settings["isAudio"] === false);
            if (role === "peer") {
                say({"kind": "settings", ...settings});
            }
        },

        // the enhancements over the picture: the worker is asked, and the
        // "enhance" event says what it made of the asking
        "setEnhance": function(wanted) {
            enhanceWanted = {
                "upscale": wanted?.["upscale"] === true,
                "interpolate": wanted?.["interpolate"] === true,
                "extrapolate": wanted?.["extrapolate"] === true
            };
            viewer?.enhance({...enhanceWanted});
        },
        "getEnhance": function() {
            return {...enhanceState, "wanted": {...enhanceWanted}};
        },

        // the keyboard and the mouse: taken on the peer, and the host told
        "setControl": function(isControl) {
            isControlWanted = (isControl === true);
            if (role !== "peer") {
                return;
            }
            say({"kind": "control", "isControl": isControlWanted});
            if (isControlWanted === true) {
                input?.enable();
            } else {
                input?.release();
            }
        },

        // the settings window's preview: the host's own encoder into a
        // decoder on this machine, no room, the whole pipeline but the line
        "preview": async function(element, options = {}) {
            if (role !== "") {
                throw new Error("The stream is busy");
            }
            role = "preview";
            if (previewViewer === null || previewViewer["canvas"] !== element) {
                previewViewer?.close();
                previewViewer = createViewer(element, function() {});
                previewViewer["canvas"] = element;
            }
            const desktop = ctx["desktop"];
            encoder = (desktop.isAvailable === true ? createDesktopEncoder(ctx) : createWebEncoder());
            encoder.onConfig = function(config) {
                previewViewer.config(config);
            };
            encoder.onChunk = onVideoChunk;
            encoder.onEnd = function() {
                stop("ended");
            };
            try {
                await encoder.start({...settings, "screenIndex": options["screenIndex"]});
            } catch (error) {
                await stop("failed");
                throw error;
            }
            emit("started", {"role": "preview"});
        },

        "stop": stop,
        "getRole": function() {
            return role;
        },
        "isSharing": function() {
            return role === "host";
        },
        "getHostInfo": function() {
            return hostInfo;
        },
        "getSettings": function() {
            return {...settings};
        },
        "isShareSupported": function() {
            return ctx["desktop"].isAvailable === true || isWebEncoderSupported();
        }
    };
};

export { createStream, DEFAULT_SETTINGS, FRAMERATES };
export default { createStream, DEFAULT_SETTINGS, FRAMERATES };
