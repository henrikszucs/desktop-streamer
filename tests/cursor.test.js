"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

// first-party dependencies
import { cursorFingerprint, iconStride, readIcon, cursorScale, normalizeCursor, encodePNG, toDataURL, packCursor } from "../src/client/web/src/room/cursor.js";
import { pictureBox } from "../src/client/web/src/room/stream-input.js";
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

// and the way the addon vendored under src/client/native reports one, which
// predates that source: one packed pixel per entry, with the alpha byte left
// empty. `shape` says which pixels are the pointer.
const packedIcon = function(width, height, shape, colour = 0xffffff, alpha = 0) {
    const data = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            data.push(shape(x, y) === true ? ((alpha << 24) | colour) >>> 0 : 0);
        }
    }
    return {"width": width, "height": height, "data": data, "xOffset": 0, "yOffset": 0};
};

const alphaOf = function(rgba, width, x, y) {
    return rgba[(y * width + x) * 4 + 3];
};

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
    assert.equal(cursorFingerprint({"width": 0, "height": 0, "data": [], "xOffset": 0, "yOffset": 0}), "");
    assert.equal(cursorFingerprint(undefined), "");
    assert.equal(cursorFingerprint({"width": 8, "height": 8, "data": [1, 2, 3]}), "");
});

//
// the two layouts: the client is not what builds the addon, so it reads either
//
test("an icon is read whether it arrives as bytes or as packed pixels", () => {
    assert.equal(iconStride(icon(16, 16)), 4);
    assert.equal(iconStride(packedIcon(16, 16, () => true)), 1);
    // fewer entries than it has pixels is not a picture, whichever it meant
    assert.equal(iconStride({"width": 16, "height": 16, "data": [1, 2, 3]}), 0);

    // the same shape in the two layouts is not the same fingerprint, and
    // neither is one of them against itself with a pixel moved
    const packed = packedIcon(8, 8, (x, y) => x === y);
    assert.notEqual(cursorFingerprint(packed), cursorFingerprint(icon(8, 8)));
    assert.notEqual(cursorFingerprint(packed), cursorFingerprint(packedIcon(8, 8, (x) => x === 0)));
});

test("a packed pixel is ARGB, and its alpha is used when the addon fills one", () => {
    const withAlpha = packedIcon(2, 2, (x) => x === 0, 0x10203f, 0x80);
    const rgba = readIcon(withAlpha);
    assert.deepEqual([...rgba.subarray(0, 4)], [0x10, 0x20, 0x3f, 0x80]);
    assert.deepEqual([...rgba.subarray(4, 8)], [0, 0, 0, 0]);
});

test("a silhouette is given the outline the addon did not report", () => {
    // the Windows arrow arrives from that build as one white shape - no alpha
    // and no black edge - and a white pointer on a white document is one
    // nobody can see, so the empty pixels around the shape become its contrast
    const square = packedIcon(5, 5, (x, y) => (x >= 2 && x <= 3 && y >= 2 && y <= 3));
    const rgba = readIcon(square);
    assert.equal(alphaOf(rgba, 5, 2, 2), 255, "the shape itself is opaque");
    assert.equal(alphaOf(rgba, 5, 1, 2), 255, "the pixel beside it is the outline");
    assert.deepEqual([...rgba.subarray((2 * 5 + 1) * 4, (2 * 5 + 1) * 4 + 3)], [0, 0, 0], "black around a light shape");
    assert.equal(alphaOf(rgba, 5, 0, 0), 0, "and a corner that touches nothing stays empty");

    // a dark pointer is outlined the other way round
    const dark = readIcon(packedIcon(5, 5, (x, y) => (x === 2 && y === 2), 0x101010));
    assert.deepEqual([...dark.subarray((2 * 5 + 1) * 4, (2 * 5 + 1) * 4 + 3)], [255, 255, 255], "white around a dark shape");

    // and a picture that came with an alpha channel is never touched
    const given = readIcon(packedIcon(5, 5, (x, y) => (x === 2 && y === 2), 0xffffff, 0xff));
    assert.equal(alphaOf(given, 5, 1, 2), 0);
});

//
// the size: fractions, since the peer knows the display only as a rectangle
//
test("the size is the shape as a fraction of the display, and the hotspot of the shape", () => {
    const size = normalizeCursor(icon(32, 64, 1, 8, 16), SCREEN, "win32");
    assert.equal(size["width"], 32 / 2560);
    assert.equal(size["height"], 64 / 1440);
    assert.equal(size["hotspotX"], 8 / 32);
    assert.equal(size["hotspotY"], 16 / 64);
});

test("a scaled Windows display is divided out, and nothing else is", () => {
    // Windows hands the cursor over at the size it is drawn on screen, which
    // follows the display's scaling, while the display is reported in logical
    // pixels: a 48 pixel pointer at 150% is 32 of the 1706 the screen is wide
    const scaled = {"width": 1706, "height": 960, "scaleFactor": 1.5};
    assert.equal(cursorScale("win32", scaled), 1.5);
    assert.equal(normalizeCursor(icon(48, 48), scaled, "win32")["width"], 32 / 1706);
    // a macOS NSImage is in points already, and the X11 scale is read off the
    // monitor's millimetres rather than off any scaling the desktop applies
    assert.equal(cursorScale("darwin", {"scaleFactor": 2}), 1);
    assert.equal(cursorScale("linux", {"scaleFactor": 1.15}), 1);
    // and a display that reports no scale at all is not one to guess at
    assert.equal(cursorScale("win32", {"width": 1920, "height": 1080}), 1);
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
    const packed = await packCursor(icon(16, 16, 1, 4, 8), SCREEN, "win32");
    assert.match(packed["image"], /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    assert.equal(packed["width"], 16 / 2560);
    // the shape's own pixels go with it: that is what the hotspot is in when
    // the peer hands the picture to its browser as a CSS cursor
    assert.equal(packed["imageWidth"], 16);
    assert.equal(packed["hotspotX"] * packed["imageWidth"], 4);
    assert.equal(packed["hotspotY"] * packed["imageHeight"], 8);
    assert.equal(toDataURL(new Uint8Array([0, 1, 2])).startsWith("data:image/png;base64,"), true);

    // a packed icon travels the same way, which is what the addon in the tree
    // actually reports
    const silhouette = await packCursor(packedIcon(32, 32, (x, y) => x + y < 20), SCREEN, "win32");
    assert.match(silhouette["image"], /^data:image\/png;base64,/);
    assert.equal(silhouette["imageWidth"], 32);

    const hidden = await packCursor({"width": 0, "height": 0, "data": []}, SCREEN, "win32");
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

// a host whose pointer is whatever the test says it is
const fakeHost = function() {
    const state = {"shape": 1, "x": 480, "y": 270, "reads": 0};
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
                    "getIcon": function() {
                        state["reads"]++;
                        return icon(16, 16, state["shape"]);
                    },
                    "getX": function() { return state["x"]; },
                    "getY": function() { return state["y"]; }
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
    assert.ok(fake.state["reads"] >= 3, "but the pointer was read every tick: " + fake.state["reads"]);

    // moving it is the position's news alone - the shape is the same shape
    const reads = fake.state["reads"];
    fake.state["x"] = 960;
    await wait(150);
    assert.equal(fake.count("cursor"), 1, "the shape did not change, so it did not go again");
    assert.equal(fake.count("cursor-move"), 2);
    assert.ok(fake.state["reads"] > reads, "and it went on being read");

    // and crossing something that changes it is the shape's
    fake.state["shape"] = 7;
    await wait(150);
    assert.equal(fake.count("cursor"), 2);
    assert.equal(fake.count("cursor-move"), 2, "standing still is still nothing to say");

    // a shape it has been given before is not packed again, but it is said
    // again, since the peer was given another one in between
    fake.state["shape"] = 1;
    await wait(150);
    assert.equal(fake.count("cursor"), 3);

    await stream.stop();
    const after = fake.state["reads"];
    const said = fake.sent.length;
    await wait(120);
    assert.equal(fake.state["reads"], after, "a share that ended looks at nothing");
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
