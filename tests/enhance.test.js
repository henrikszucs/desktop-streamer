"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

// first-party dependencies
import { KINDS, OFF, TILE_STEP, HALO, schedule, planTiles, isSameShape, normalizeOptions, isAnyOn, modelsFor, bytesOf, patchInputDims, readInputDims } from "../src/client/web/src/room/stream-enhance.js";

const modelsPath = path.resolve(import.meta.dirname, "..", "src", "client", "web", "media", "models");

// The enhancer runs in the decoder's worker on a GPU the test runner has not
// got, but what it decides *before* touching one is plain arithmetic: which
// pictures one arriving frame turns into and where each sits in the frame
// interval, which models a choice needs, and how big a picture is on the GPU.
// That is what is proved here - the tiling a frame is cut into as well, since
// a model is never handed a whole frame - and the one thing it does to a
// model file:
// the WebGL provider runs static shapes only, so the symbolic input
// dimensions of a graph are written as the frame's in the protobuf bytes
// before a session is made of it.

test("the options are three booleans whatever was handed in", () => {
    assert.deepEqual(KINDS, ["upscale", "interpolate", "extrapolate"]);
    assert.deepEqual(normalizeOptions(undefined), OFF);
    assert.deepEqual(normalizeOptions({"upscale": 1, "interpolate": "yes"}), OFF);
    assert.deepEqual(normalizeOptions({"upscale": true, "other": true}), {"upscale": true, "interpolate": false, "extrapolate": false});
    assert.equal(isAnyOn(OFF), false);
    assert.equal(isAnyOn({...OFF, "extrapolate": true}), true);
});

test("nothing on is the frame itself, now", () => {
    assert.deepEqual(schedule(OFF, true), [{"kind": "frame", "at": 0}]);
    assert.deepEqual(schedule({...OFF, "upscale": true}, true), [{"kind": "frame", "at": 0}]);
});

test("a two-frame model waits for its second frame", () => {
    // the first frame of a stream has nothing to pair with, so it is drawn as
    // it is whatever is on
    assert.deepEqual(schedule({...OFF, "interpolate": true}, false), [{"kind": "frame", "at": 0}]);
    assert.deepEqual(schedule({...OFF, "extrapolate": true}, false), [{"kind": "frame", "at": 0}]);
});

test("the interpolated frame stands in before the real one, the extrapolated after it", () => {
    assert.deepEqual(schedule({...OFF, "interpolate": true}, true), [
        {"kind": "interpolate", "at": 0},
        {"kind": "frame", "at": 1 / 2}
    ]);
    assert.deepEqual(schedule({...OFF, "extrapolate": true}, true), [
        {"kind": "frame", "at": 0},
        {"kind": "extrapolate", "at": 1 / 2}
    ]);
    assert.deepEqual(schedule({"upscale": true, "interpolate": true, "extrapolate": true}, true), [
        {"kind": "interpolate", "at": 0},
        {"kind": "frame", "at": 1 / 3},
        {"kind": "extrapolate", "at": 2 / 3}
    ]);
});

test("every schedule presents the real frame once and in order", () => {
    for (const upscale of [false, true]) {
        for (const interpolate of [false, true]) {
            for (const extrapolate of [false, true]) {
                for (const hasPrevious of [false, true]) {
                    const steps = schedule({"upscale": upscale, "interpolate": interpolate, "extrapolate": extrapolate}, hasPrevious);
                    const real = steps.filter((step) => step["kind"] === "frame");
                    assert.equal(real.length, 1);
                    for (let i = 1; i < steps.length; i++) {
                        assert.equal(steps[i]["at"] > steps[i - 1]["at"], true, "steps out of order");
                    }
                    assert.equal(steps[0]["at"], 0, "the first picture is drawn at once");
                    assert.equal(steps[steps.length - 1]["at"] < 1, true, "nothing is drawn after the next frame is due");
                }
            }
        }
    }
});

test("only the models that are on are loaded", () => {
    assert.deepEqual(modelsFor(OFF), []);
    assert.deepEqual(modelsFor({"upscale": true, "interpolate": false, "extrapolate": true}), ["upscale", "extrapolate"]);
});

test("a picture's bytes are its float32 count rounded to 16", () => {
    assert.equal(bytesOf([1, 3, 2, 2]), 48);
    assert.equal(bytesOf([1, 3, 1, 1]), 16);         // 12 bytes, read in 16
    assert.equal(bytesOf([1, 3, 1080, 1920]), 1080 * 1920 * 3 * 4);
    assert.equal(bytesOf([1, 6, 3, 3]) % 16, 0);
});

test("every mock graph is there and takes a batch of tiles of any size, one frame per input", async () => {
    for (const kind of KINDS) {
        const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, kind + ".onnx")));
        const inputs = readInputDims(bytes);
        assert.equal(inputs.length, (kind === "upscale" ? 1 : 2), kind + " takes " + (kind === "upscale" ? "one frame" : "two frames"));
        for (const dims of inputs) {
            assert.deepEqual(dims, ["N", 3, "H", "W"], kind + " takes a batch of NCHW frames");
        }
    }
});

test("the symbolic dimensions of every input are written as the batch's, and nothing else moves", async () => {
    for (const kind of KINDS) {
        const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, kind + ".onnx")));
        const patched = patchInputDims(bytes, [36, 188, 328]);
        const inputs = readInputDims(patched);
        for (const dims of inputs) {
            assert.deepEqual(dims, [36, 3, 188, 328]);
        }

        // the fixed dimension was left as it was, and the file is one byte
        // per input shorter: a one letter name (key, length, letter) is three
        // bytes, and so is a value under 16384 (key, two byte varint) - the
        // batch under 128 is two
        assert.equal(patched.length, bytes.length - inputs.length, kind + ": three names became three values per input");
        for (const dims of readInputDims(patchInputDims(patched, [7, 7, 7]))) {
            assert.deepEqual(dims, [36, 3, 188, 328], "a fixed dimension is not rewritten");
        }
    }
});

test("a varint over one byte round-trips through the patch", async () => {
    const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, "upscale.onnx")));
    assert.deepEqual(readInputDims(patchInputDims(bytes, [144, 2160, 3840]))[0], [144, 3, 2160, 3840]);
    assert.deepEqual(readInputDims(patchInputDims(bytes, [1, 16, 300000]))[0], [1, 3, 16, 300000]);
});

test("a frame is tiled so every pixel is kept once and every window is inside it", () => {
    for (const [width, height] of [[1920, 1080], [1280, 720], [1000, 700], [500, 200], [328, 188], [64, 32]]) {
        const plan = planTiles(width, height);
        const covered = new Uint8Array(width * height);
        for (const tile of plan["tiles"]) {
            assert.equal(tile["ix"] >= 0 && tile["iy"] >= 0, true);
            assert.equal(tile["ix"] + plan["tileWidth"] <= width && tile["iy"] + plan["tileHeight"] <= height, true, "a window over the edge");
            assert.equal(tile["ox"] + tile["w"] <= plan["tileWidth"] && tile["oy"] + tile["h"] <= plan["tileHeight"], true, "a kept region outside its window");
            for (let y = tile["y"]; y < tile["y"] + tile["h"]; y++) {
                for (let x = tile["x"]; x < tile["x"] + tile["w"]; x++) {
                    covered[y * width + x]++;
                }
            }
        }
        assert.equal(covered.every((count) => count === 1), true, width + "x" + height + " is not covered exactly once");
    }
});

test("every 16:9 frame from 720p up is whole steps, each with its halo", () => {
    for (const [width, height, across, down] of [[1280, 720, 4, 4], [1920, 1080, 6, 6], [2560, 1440, 8, 8], [3840, 2160, 12, 12]]) {
        const plan = planTiles(width, height);
        assert.equal(plan["tiles"].length, across * down);
        assert.equal(plan["tileWidth"], TILE_STEP["width"] + 2 * HALO);
        assert.equal(plan["tileHeight"], TILE_STEP["height"] + 2 * HALO);
        assert.equal(plan["across"], across);
        for (const tile of plan["tiles"]) {
            assert.equal(tile["w"], TILE_STEP["width"]);
            assert.equal(tile["h"], TILE_STEP["height"]);
        }
        // the row-major order the tiles are batched in is the order a frame
        // pixel finds its tile by division, which is what the draw relies on
        plan["tiles"].forEach(function(tile, index) {
            assert.equal(Math.floor(tile["y"] / TILE_STEP["height"]) * across + Math.floor(tile["x"] / TILE_STEP["width"]), index);
        });
        // an inner tile has its halo on every side, an edge tile has the
        // window slid back into the frame instead
        const inner = plan["tiles"][across + 1];
        assert.deepEqual([inner["ox"], inner["oy"]], [HALO, HALO]);
        assert.deepEqual([plan["tiles"][0]["ox"], plan["tiles"][0]["oy"]], [0, 0]);
        const last = plan["tiles"][plan["tiles"].length - 1];
        assert.equal(last["ox"], 2 * HALO);
    }
});

// a two-frame model is only ever fed two pictures of one size: a host that
// changed resolution is a previous picture that pairs with nothing
test("pictures of another frame size are not the same shape", () => {
    const picture = function(width, height) {
        return {"plan": planTiles(width, height)};
    };
    assert.equal(isSameShape(picture(1280, 720), picture(1280, 720)), true);
    assert.equal(isSameShape(picture(1280, 720), picture(1920, 1080)), false);
    // the same tile grid, a different frame: 1280x720 and 1270x720 are both 4x4 tiles
    assert.equal(isSameShape(picture(1280, 720), picture(1270, 720)), false);
    assert.equal(isSameShape(null, picture(1280, 720)), false);
});

test("a frame smaller than a tile is one tile of its own size", () => {
    const plan = planTiles(64, 32);
    assert.equal(plan["tiles"].length, 1);
    assert.deepEqual([plan["tileWidth"], plan["tileHeight"]], [64, 32]);
    assert.deepEqual(plan["tiles"][0], {"x": 0, "y": 0, "w": 64, "h": 32, "ix": 0, "iy": 0, "ox": 0, "oy": 0});
});
