"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

// first-party dependencies
import { cursorFingerprint, hasPicture, isBlank, readIcon, cursorScale, normalizeCursor, encodePNG, toDataURL, packCursor } from "../src/client/web/src/room/cursor.js";
import { pictureBox, createInput } from "../src/client/web/src/room/stream-input.js";
import { createStream } from "../src/client/web/src/room/stream.js";

// The host's own mouse pointer is not in the picture it sends: it is read with
// easy-control, packed here and drawn by the peer over the canvas. Both halves
// of that are provable under Node - the packing because it is pure (the PNG is
// written by hand over CompressionStream rather than through a canvas), and
// where the peer puts it because that is the same letterbox mapping the peer's
// own clicks travel through, `pictureBox` in stream-input.js. A pointer drawn
// in the wrong place and a click landing in the wrong place are one defect.

// an icon the way Mouse.getIcon() reports one: RGBA bytes, its size, and the
// pixel inside it that is the pointer
const icon = function(width, height, fill = 1, xOffset = 0, yOffset = 0) {
    const data = [];
    for (let i = 0; i < width * height * 4; i++) {
        data.push((i * fill) % 256);
    }
    return {"width": width, "height": height, "data": data, "xOffset": xOffset, "yOffset": yOffset};
};

// and a pointer the host has hidden, as the addon reports one
const HIDDEN = {"width": 0, "height": 0, "data": new Uint8Array(0), "xOffset": 0, "yOffset": 0};

// or hidden by an application handing the system a shape with nothing in it
const BLANK = {"width": 16, "height": 16, "data": new Uint8Array(16 * 16 * 4), "xOffset": 0, "yOffset": 0};

const SCREEN = {"width": 2560, "height": 1440, "x": 0, "y": 0, "index": 0, "scaleFactor": 1};

//
// the fingerprint: what says a shape is the one the peer already has
//
test("the fingerprint is the shape, and nothing else is the same shape", () => {
    assert.equal(cursorFingerprint(icon(32, 32)), cursorFingerprint(icon(32, 32)));
    assert.notEqual(cursorFingerprint(icon(32, 32)), cursorFingerprint(icon(32, 32, 3)));
    assert.notEqual(cursorFingerprint(icon(32, 32)), cursorFingerprint(icon(24, 24)));
    // the hotspot moves without a pixel changing: a text caret and an arrow
    // can be the same picture pointing at two different places
    assert.notEqual(cursorFingerprint(icon(32, 32)), cursorFingerprint(icon(32, 32, 1, 4, 4)));
});

test("a pointer the host is not showing has no fingerprint at all", () => {
    assert.equal(cursorFingerprint(HIDDEN), "");
    assert.equal(cursorFingerprint(undefined), "");
    assert.equal(cursorFingerprint({"width": 8, "height": 8, "data": [1, 2, 3]}), "");
});

test("a shape shows nothing when it has no picture, or not one pixel that is not transparent", () => {
    assert.equal(isBlank(HIDDEN), true);
    assert.equal(isBlank(BLANK), true);
    assert.equal(isBlank(icon(16, 16)), false);
    // one pixel is enough, the last one included
    const data = new Uint8Array(16 * 16 * 4);
    data[data.length - 1] = 1;
    assert.equal(isBlank({...BLANK, "data": data}), false);
    // colour behind no alpha is still nothing to see
    assert.equal(isBlank({...BLANK, "data": new Uint8Array(16 * 16 * 4).fill(255).map(function(value, i) {
        return (i % 4 === 3 ? 0 : value);
    })}), true);
});

//
// the picture: RGBA bytes, the same on every platform
//
test("an icon is a picture only when it holds the bytes its size says", () => {
    assert.equal(hasPicture(icon(16, 16)), true);
    // what the addon actually hands over is a Uint8Array
    assert.equal(hasPicture({...icon(4, 4), "data": new Uint8Array(4 * 4 * 4)}), true);
    // one byte a pixel is not a picture, nor is a hidden pointer
    assert.equal(hasPicture({"width": 16, "height": 16, "data": new Uint8Array(16 * 16)}), false);
    assert.equal(hasPicture(HIDDEN), false);
    assert.equal(readIcon(HIDDEN), null);
});

test("the pixels are read as they arrive, a byte a channel", () => {
    const data = new Uint8Array([0x10, 0x20, 0x3f, 0x80, 0, 0, 0, 0]);
    const rgba = readIcon({"width": 2, "height": 1, "data": data, "xOffset": 0, "yOffset": 0});
    assert.deepEqual([...rgba], [...data]);
    // a copy, so a buffer the addon reuses cannot change a shape already packed
    assert.notEqual(rgba.buffer, data.buffer);
});

//
// the size: fractions, since the peer knows the display only as a rectangle
//
test("the size is the shape as a fraction of the display, and the hotspot of the shape", () => {
    const size = normalizeCursor(icon(32, 64, 1, 8, 16), SCREEN);
    assert.equal(size["width"], 32 / 2560);
    assert.equal(size["height"], 64 / 1440);
    assert.equal(size["hotspotX"], 8 / 32);
    assert.equal(size["hotspotY"], 16 / 64);
});

test("the display's scale is divided out, since the shape is in physical pixels", () => {
    // the display is reported in logical pixels and the shape in physical
    // ones: a 48 pixel pointer at 150% on Windows is 32 of the 1706 the screen
    // is wide
    const scaled = {"width": 1706, "height": 960, "scaleFactor": 1.5};
    assert.equal(cursorScale(scaled), 1.5);
    assert.equal(normalizeCursor(icon(48, 48), scaled)["width"], 32 / 1706);
    // and a Retina Mac's 64 pixel pointer is 32 of the 1440 points it is wide
    const retina = {"width": 1440, "height": 900, "scaleFactor": 2};
    assert.equal(normalizeCursor(icon(64, 64), retina)["width"], 32 / 1440);
    // X11 has no logical size, so its scale is 1 - and a display that reports
    // none at all is not one to guess at
    assert.equal(cursorScale({"scaleFactor": 1}), 1);
    assert.equal(cursorScale({"width": 1920, "height": 1080}), 1);
});

//
// the PNG: written by hand, so it is worth reading back
//
test("the shape is a PNG with the right header and the pixels it was given", async () => {
    const shape = icon(8, 4, 7);
    const png = await encodePNG(8, 4, shape["data"]);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(String.fromCharCode(...png.subarray(12, 16)), "IHDR");

    const header = new DataView(png.buffer, png.byteOffset + 16, 13);
    assert.equal(header.getUint32(0), 8);
    assert.equal(header.getUint32(4), 4);
    assert.equal(header.getUint8(8), 8);        // bits per channel
    assert.equal(header.getUint8(9), 6);        // RGBA
    assert.equal(header.getUint8(12), 0);       // not interlaced

    // and the bytes back out of it: every row unfiltered, behind the zlib
    // stream that IDAT is
    const idatAt = String.fromCharCode(...png).indexOf("IDAT");
    const length = new DataView(png.buffer, png.byteOffset + idatAt - 4, 4).getUint32(0);
    const raw = zlib.inflateSync(Buffer.from(png.subarray(idatAt + 4, idatAt + 4 + length)));
    assert.equal(raw.length, (8 * 4 + 1) * 4);
    for (let y = 0; y < 4; y++) {
        assert.equal(raw[y * 33], 0, "row " + y + " is unfiltered");
        assert.deepEqual([...raw.subarray(y * 33 + 1, y * 33 + 33)], shape["data"].slice(y * 32, y * 32 + 32));
    }
});

test("the shape travels as a data URL, and a hidden pointer as nothing", async () => {
    const packed = await packCursor(icon(16, 16, 1, 4, 8), SCREEN);
    assert.match(packed["image"], /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    assert.equal(packed["width"], 16 / 2560);
    // the shape's own pixels go with it: that is what the hotspot is in when
    // the peer hands the picture to its browser as a CSS cursor
    assert.equal(packed["imageWidth"], 16);
    assert.equal(packed["hotspotX"] * packed["imageWidth"], 4);
    assert.equal(packed["hotspotY"] * packed["imageHeight"], 8);
    assert.equal(toDataURL(new Uint8Array([0, 1, 2])).startsWith("data:image/png;base64,"), true);

    const hidden = await packCursor(HIDDEN, SCREEN);
    assert.equal(hidden["image"], null);
});

test("a PNG is smaller than the pixels it was made of", async () => {
    // which is the whole reason the shape is encoded at all rather than sent
    // as bytes: a cursor is mostly nothing, and a shape crosses the line
    // whenever the pointer changes what it is over
    const shape = icon(64, 64, 0);              // one flat colour, as most of a cursor is
    const png = await encodePNG(64, 64, shape["data"]);
    assert.ok(png.length < 64 * 64 * 4 / 4, "a flat 64x64 shape packed to " + png.length + " bytes");
});

//
// the watch: what the host looks at, and the little of it the peer hears
//
// This one runs the real clock through the real stream - a fake addon and a
// fake room at either end of it - because the rule worth proving is not that a
// shape packs but that a pointer nobody moved costs the line nothing.

const wait = function(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
};

// a host whose pointer is whatever the test says it is. `looks` counts the
// shape's id being asked, every tick, and `reads` the picture being read,
// which is only worth doing when that id changed. A shape of 0 is a pointer
// the host hides, one below 0 a shape with nothing to see in it, `isShownOnMove`
// a hidden pointer that comes back once it is moved - hidden while typing, or
// by a player gone idle - and `moves` the distances the peer moved it by.
const fakeHost = function() {
    const state = {"shape": 1, "x": 480, "y": 270, "looks": 0, "reads": 0, "isShownOnMove": false, "moves": []};
    const shownOnMove = function() {
        if (state["isShownOnMove"] === true && state["shape"] <= 0) {
            state["shape"] = 1;
        }
    };
    const sent = [];
    const target = new EventTarget();
    const room = {
        "addEventListener": target.addEventListener.bind(target),
        "removeEventListener": target.removeEventListener.bind(target),
        "dispatch": function(type, detail) {
            target.dispatchEvent(new CustomEvent(type, {"detail": detail}));
        },
        "send": async function(message) {
            sent.push(message);
            return true;
        },
        "sendFrame": function() { return true; },
        "isConnected": function() { return true; },
        "getMode": function() { return "direct"; },
        "getFrameLimit": function() { return 16000; },
        "leave": function() {}
    };
    const ctx = {
        "room": room,
        "localization": {"get": function(key) { return key; }},
        "desktop": {
            "isAvailable": true,
            "ffmpegPath": "ffmpeg",
            "os": {"platform": function() { return "win32"; }},
            "Control": {
                "Screen": {"list": function() {
                    return [{"width": 1920, "height": 1080, "x": 0, "y": 0, "isPrimary": true, "scaleFactor": 1}];
                }},
                "Mouse": {
                    "getIconId": function() {
                        state["looks"]++;
                        return state["shape"];
                    },
                    "getIcon": function() {
                        state["reads"]++;
                        if (state["shape"] === 0) {
                            return HIDDEN;
                        }
                        return (state["shape"] < 0 ? BLANK : icon(16, 16, state["shape"]));
                    },
                    "getPosition": function() {
                        return {"x": state["x"], "y": state["y"]};
                    },
                    "setPosition": function(x, y) {
                        state["x"] = x;
                        state["y"] = y;
                        shownOnMove();
                    },
                    "moveBy": function(x, y) {
                        state["moves"].push([x, y]);
                        state["x"] += x;
                        state["y"] += y;
                        shownOnMove();
                    }
                }
            },
            // the line never runs: what is being timed here is the pointer
            "FFmpegVideoEncoder": class {
                start() { return Promise.resolve(); }
                kill() {}
                end() { return Promise.resolve(); }
            }
        }
    };
    const count = function(kind) {
        return sent.filter(function(message) { return message["kind"] === kind; }).length;
    };
    return {"ctx": ctx, "room": room, "state": state, "sent": sent, "count": count};
};

test("a pointer that has not changed is looked at, not sent", async () => {
    const fake = fakeHost();
    const stream = createStream(fake.ctx);
    fake.room.dispatch("connected", {"isHost": true});
    await wait(250);

    // the shape and the position each crossed once, however many ticks fit
    assert.equal(fake.count("cursor"), 1, "the shape the peer did not have");
    assert.equal(fake.count("cursor-move"), 1, "and where it was");
    assert.ok(fake.state["looks"] >= 3, "but the pointer was looked at every tick: " + fake.state["looks"]);
    assert.equal(fake.state["reads"], 1, "and its picture read once, since its id never changed");

    // moving it is the position's news alone - the shape is the same shape
    const looks = fake.state["looks"];
    fake.state["x"] = 960;
    await wait(150);
    assert.equal(fake.count("cursor"), 1, "the shape did not change, so it did not go again");
    assert.equal(fake.count("cursor-move"), 2);
    assert.ok(fake.state["looks"] > looks, "and it went on being looked at");
    assert.equal(fake.state["reads"], 1);

    // and crossing something that changes it is the shape's
    fake.state["shape"] = 7;
    await wait(150);
    assert.equal(fake.count("cursor"), 2);
    assert.equal(fake.state["reads"], 2, "a new id is the one picture read");
    assert.equal(fake.count("cursor-move"), 2, "standing still is still nothing to say");

    // a shape it has been given before is not packed again, but it is said
    // again, since the peer was given another one in between
    fake.state["shape"] = 1;
    await wait(150);
    assert.equal(fake.count("cursor"), 3);

    await stream.stop();
    const after = fake.state["looks"];
    const said = fake.sent.length;
    await wait(120);
    assert.equal(fake.state["looks"], after, "a share that ended looks at nothing");
    assert.equal(fake.sent.length, said);
});

test("the peer driving is the host saying nothing about its pointer", async () => {
    const fake = fakeHost();
    const stream = createStream(fake.ctx);
    fake.room.dispatch("connected", {"isHost": true});
    await wait(120);
    const moves = fake.count("cursor-move");

    // while the peer holds the mouse, its own pointer is where the host's is:
    // what this side would send is a round trip behind the hand moving it
    fake.room.dispatch("message", {"data": {"kind": "control", "isControl": true}});
    fake.state["x"] = 100;
    await wait(150);
    assert.equal(fake.count("cursor-move"), moves, "nothing while the peer is driving");

    // letting go says where it was left, at once
    fake.room.dispatch("message", {"data": {"kind": "control", "isControl": false}});
    await wait(150);
    assert.equal(fake.count("cursor-move"), moves + 1);
    await stream.stop();
});

//
// a pointer the host holds: what the peer is told, and what it does about it
//
// A game - or a pointer-locked page - on the host hides the pointer and keeps
// it in one place whatever moves it, reading the distances a mouse makes
// instead. The peer has to hold its own then, or it walks off its window while
// the host's goes on turning.

// the peer moving the host's pointer across the picture for `ms`, one input
// message per animation frame the way stream-input.js batches them
const drive = async function(fake, ms) {
    for (let i = 0; i < ms / 16; i++) {
        const x = 0.2 + (i % 40) * 0.01;
        fake.room.dispatch("message", {"data": {"kind": "input", "events": [{"t": "move", "x": x, "y": 0.4}]}});
        await wait(16);
    }
};

const locks = function(fake) {
    return fake.sent.filter(function(message) {
        return message["kind"] === "cursor-lock";
    }).map(function(message) {
        return message["isLocked"];
    });
};

test("a pointer that stays hidden while the peer moves it is held on the peer too, until it is shown", async (t) => {
    const fake = fakeHost();
    const stream = createStream(fake.ctx);
    // a failed assertion must not leave the watch ticking
    t.after(stream.stop);
    fake.room.dispatch("connected", {"isHost": true});
    await wait(100);
    fake.room.dispatch("message", {"data": {"kind": "control", "isControl": true}});

    // the game takes it, hidden however the peer moves it
    fake.state["shape"] = 0;
    await drive(fake, 300);
    assert.deepEqual(locks(fake), [true], "said once, and only once it was sure");

    // from then on the peer sends distances, and those are what a game reads
    fake.room.dispatch("message", {"data": {"kind": "input", "events": [
        {"t": "move-by", "x": 12.5, "y": -3},
        {"t": "move-by", "x": 1e9, "y": "nonsense"}
    ]}});
    assert.deepEqual(fake.state["moves"], [[12.5, -3], [100000, 0]], "within the addon's limit, and nothing for what is not a number");

    // the game lets go - a menu, the desktop - and shows the pointer again
    fake.state["shape"] = 5;
    await wait(100);
    assert.deepEqual(locks(fake), [true, false]);
});

test("a shape with nothing to see in it is a hidden pointer too", async (t) => {
    const fake = fakeHost();
    const stream = createStream(fake.ctx);
    t.after(stream.stop);
    fake.room.dispatch("connected", {"isHost": true});
    await wait(100);
    fake.room.dispatch("message", {"data": {"kind": "control", "isControl": true}});

    fake.state["shape"] = -1;
    await drive(fake, 300);
    assert.deepEqual(locks(fake), [true]);
});

test("a pointer that is hidden only until it moves, or that nobody moves, is not held on the peer", async (t) => {
    const fake = fakeHost();
    const stream = createStream(fake.ctx);
    t.after(stream.stop);
    fake.room.dispatch("connected", {"isHost": true});
    await wait(100);

    // hidden where nobody drives is nothing the peer would walk off
    fake.state["shape"] = 0;
    await drive(fake, 250);
    assert.deepEqual(locks(fake), [], "nobody driving");

    // hidden while the peer drives but does not move it - it typed
    fake.room.dispatch("message", {"data": {"kind": "control", "isControl": true}});
    await wait(300);
    assert.deepEqual(locks(fake), [], "not moved");

    // and back the moment it is moved, as a pointer hidden while typing or by
    // a player gone idle is
    fake.state["isShownOnMove"] = true;
    await drive(fake, 250);
    assert.deepEqual(locks(fake), [], "shown again");
    assert.equal(fake.state["shape"], 1);
});

test("letting go of the mouse lets go of the lock, and a restart of the share keeps it", async (t) => {
    const fake = fakeHost();
    const stream = createStream(fake.ctx);
    t.after(stream.stop);
    fake.room.dispatch("connected", {"isHost": true});
    await wait(100);
    fake.room.dispatch("message", {"data": {"kind": "control", "isControl": true}});
    fake.state["shape"] = 0;
    await drive(fake, 300);
    assert.deepEqual(locks(fake), [true]);

    // a new frame rate is a new encoder on the same display, not a new game
    const shares = fake.count("share");
    fake.room.dispatch("message", {"data": {"kind": "settings", "framerate": 60}});
    await wait(700);
    assert.equal(fake.count("share"), shares + 1, "the share restarted");
    await drive(fake, 150);
    assert.deepEqual(locks(fake), [true], "nothing said again");

    fake.room.dispatch("message", {"data": {"kind": "control", "isControl": false}});
    assert.deepEqual(locks(fake), [true, false]);
});

// the peer's half: a canvas, the document it is in and a frame clock, enough
// for stream-input.js to lock, move and let go under Node
const fakePeer = function(options = {}) {
    const doc = new EventTarget();
    doc.pointerLockElement = null;
    doc.fullscreenElement = null;
    doc.exitPointerLock = function() {
        doc.pointerLockElement = null;
        doc.dispatchEvent(new Event("pointerlockchange"));
    };
    const canvas = new EventTarget();
    const asked = [];
    canvas.getBoundingClientRect = function() {
        return {"left": 0, "top": 0, "width": 1920, "height": 1080};
    };
    canvas.focus = function() {};
    canvas.setPointerCapture = function() {
        if (doc.pointerLockElement !== null) {
            throw new Error("InvalidStateError");
        }
    };
    // granted unless the test refuses it; raw counts only where it says so
    canvas.requestPointerLock = function(lockOptions) {
        asked.push(lockOptions ?? null);
        if (lockOptions?.["unadjustedMovement"] === true && options["isRaw"] === false) {
            return Promise.reject(Object.assign(new Error("raw motion"), {"name": "NotSupportedError"}));
        }
        if (options["isRefused"]?.() === true) {
            return Promise.reject(Object.assign(new Error("no gesture"), {"name": "NotAllowedError"}));
        }
        doc.pointerLockElement = canvas;
        doc.dispatchEvent(new Event("pointerlockchange"));
        return Promise.resolve();
    };
    const globals = {
        "document": doc,
        "window": new EventTarget(),
        "requestAnimationFrame": function(callback) {
            return setTimeout(callback, 0);
        },
        "cancelAnimationFrame": function(id) {
            clearTimeout(id);
        }
    };
    const saved = {};
    for (const [name, value] of Object.entries(globals)) {
        saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, {"value": value, "configurable": true, "writable": true});
    }
    const restore = function() {
        for (const [name, descriptor] of Object.entries(saved)) {
            if (typeof descriptor === "undefined") {
                delete globalThis[name];
            } else {
                Object.defineProperty(globalThis, name, descriptor);
            }
        }
    };
    const sent = [];
    const ctx = {"conf": {"local": {"exitShortcuts": options["exitShortcuts"] ?? []}}, "desktop": {"isAvailable": false}};
    const input = createInput(canvas, ctx, function(message) {
        sent.push(...message["events"]);
    }, options["onRelease"] ?? function() {}, function() {}, options["onLockRefused"] ?? function() {});
    input.setPicture({"width": 1920, "height": 1080});
    const pointer = function(type, fields) {
        canvas.dispatchEvent(Object.assign(new Event(type), {"pointerId": 1, "button": 0, "clientX": 0, "clientY": 0,
            "movementX": 0, "movementY": 0}, fields));
    };
    return {"doc": doc, "canvas": canvas, "asked": asked, "input": input, "sent": sent, "pointer": pointer, "restore": restore};
};

test("the peer holds its pointer while the host's is held, and moves it by distances", async (t) => {
    const peer = fakePeer();
    t.after(peer.restore);
    peer.input.enable();

    peer.input.setLocked(true);
    await wait(0);
    assert.equal(peer.doc.pointerLockElement, peer.canvas, "locked over the canvas");
    assert.deepEqual(peer.asked, [{"unadjustedMovement": true}], "as raw counts, which the host's own acceleration is applied to");

    // one frame's moves are one distance, since each is a part of it
    peer.pointer("pointermove", {"movementX": 3, "movementY": 1, "clientX": 500, "clientY": 500});
    peer.pointer("pointermove", {"movementX": 4.25, "movementY": -2});
    await wait(5);
    assert.deepEqual(peer.sent, [{"t": "move-by", "x": 7.25, "y": -1}]);

    // the host shows its pointer again: this one is the peer's again, and
    // where it is goes back to being a place
    peer.sent.length = 0;
    peer.input.setLocked(false);
    assert.equal(peer.doc.pointerLockElement, null);
    peer.pointer("pointermove", {"movementX": 9, "clientX": 960, "clientY": 540});
    await wait(5);
    assert.deepEqual(peer.sent, [{"t": "move", "x": 0.5, "y": 0.5}]);
});

test("a lock the browser refuses waits for a click, and one without raw counts is asked for plainly", async (t) => {
    let isRefused = true;
    let refusals = 0;
    const peer = fakePeer({
        "isRaw": false,
        "isRefused": function() { return isRefused; },
        "onLockRefused": function() { refusals++; }
    });
    t.after(peer.restore);
    peer.input.enable();

    peer.input.setLocked(true);
    await wait(0);
    assert.equal(peer.doc.pointerLockElement, null, "no gesture yet");
    assert.equal(refusals, 1, "and the screen is told, so it can ask for the click");

    // a click refused too is the person's own doing, and nothing to say again
    peer.pointer("pointerdown", {"clientX": 960, "clientY": 540});
    await wait(5);
    assert.equal(refusals, 1);

    // the click is the gesture, and it still reaches the host
    isRefused = false;
    peer.pointer("pointerdown", {"clientX": 960, "clientY": 540});
    await wait(5);
    assert.equal(peer.doc.pointerLockElement, peer.canvas);
    assert.deepEqual(peer.asked.slice(-2), [{"unadjustedMovement": true}, null], "the platform's own motion where raw is not there");
    assert.ok(peer.sent.some(function(event) { return event["t"] === "down" && event["b"] === "left"; }));

    // letting go of the mouse lets go of the lock, and a lock is not wanted
    // again until the host says so for the new turn at driving
    peer.input.release();
    assert.equal(peer.doc.pointerLockElement, null);
    peer.input.enable();
    peer.pointer("pointerdown", {"clientX": 960, "clientY": 540});
    await wait(5);
    assert.equal(peer.doc.pointerLockElement, null);
});

test("the exit shortcut lets go of the lock first, and of the mouse on a second hold", async (t) => {
    let released = 0;
    const peer = fakePeer({
        "exitShortcuts": [{"delay": 0.2, "keys": ["q"]}],
        "onRelease": function() { released++; }
    });
    t.after(peer.restore);
    peer.input.enable();
    peer.input.setLocked(true);
    await wait(0);

    const hold = async function() {
        peer.canvas.dispatchEvent(Object.assign(new Event("keydown"), {"code": "KeyQ", "key": "q", "repeat": false}));
        await wait(260);
        peer.canvas.dispatchEvent(Object.assign(new Event("keyup"), {"code": "KeyQ", "key": "q"}));
    };
    await hold();
    assert.equal(peer.doc.pointerLockElement, null, "the innermost thing");
    assert.equal(peer.input.isEnabled(), true);
    assert.equal(released, 0);

    await hold();
    assert.equal(peer.input.isEnabled(), false);
    assert.equal(released, 1);
});

//
// where the peer draws it: the picture inside the canvas, not the canvas
//
test("the picture is centred in the element and letterboxed on the two sides it has to be", () => {
    // a 16:9 picture in a 2:1 element: bars left and right, the full height
    const canvas = {"getBoundingClientRect": function() {
        return {"left": 10, "top": 20, "width": 1600, "height": 800};
    }};
    const box = pictureBox(canvas, {"width": 1920, "height": 1080});
    assert.equal(box["height"], 800);
    assert.equal(box["width"], 800 * 16 / 9);
    assert.equal(box["top"], 0);
    assert.equal(box["left"], (1600 - 800 * 16 / 9) / 2);
    assert.equal(box["rect"].left, 10);
});

test("a picture that fits is not letterboxed, and one nobody has is no box", () => {
    const canvas = {"getBoundingClientRect": function() {
        return {"left": 0, "top": 0, "width": 960, "height": 540};
    }};
    const box = pictureBox(canvas, {"width": 1920, "height": 1080});
    assert.deepEqual([box["left"], box["top"], box["width"], box["height"]], [0, 0, 960, 540]);

    // the element is a placeholder for the worker's canvas and says nothing
    // about the picture, so no picture is no mapping rather than a guess
    assert.equal(pictureBox(canvas, null), undefined);
    assert.equal(pictureBox(canvas, {"width": 0, "height": 0}), undefined);
});
