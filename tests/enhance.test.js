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
import { KINDS, OFF, schedule, normalizeOptions, isAnyOn, modelsFor, bytesOf, patchInputDims, readInputDims } from "../src/client/web/src/room/stream-enhance.js";

const modelsPath = path.resolve(import.meta.dirname, "..", "src", "client", "web", "media", "models");

// The enhancer runs in the decoder's worker on a GPU the test runner has not
// got, but what it decides *before* touching one is plain arithmetic: which
// pictures one arriving frame turns into and where each sits in the frame
// interval, which models a choice needs, and how big a picture is on the GPU.
// That is what is proved here - and the one thing it does to a model file:
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

test("every mock graph is there and takes a dynamic picture", async () => {
    for (const kind of KINDS) {
        const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, kind + ".onnx")));
        const inputs = readInputDims(bytes);
        assert.equal(inputs.length, 1, kind + " has one input");
        assert.equal(inputs[0].length, 4, kind + " takes NCHW");
        assert.equal(inputs[0][0], 1);
        assert.equal(inputs[0][1], (kind === "upscale" ? 3 : 6), kind + " takes " + (kind === "upscale" ? "one frame" : "two frames"));
        assert.equal(inputs[0][2], "H");
        assert.equal(inputs[0][3], "W");
    }
});

test("the symbolic input dimensions are written as the frame's, and nothing else moves", async () => {
    for (const kind of KINDS) {
        const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, kind + ".onnx")));
        const patched = patchInputDims(bytes, [1080, 1920]);
        const inputs = readInputDims(patched);
        assert.deepEqual(inputs[0], [1, (kind === "upscale" ? 3 : 6), 1080, 1920]);

        // the fixed dimensions were left as they were, and the file is the
        // same size: a one letter name (key, length, letter) is three bytes,
        // and so is a value under 16384 (key, two byte varint)
        assert.equal(patched.length, bytes.length, kind + ": two names became two values of the same size");
        assert.deepEqual(readInputDims(patchInputDims(patched, [7, 7]))[0], [1, (kind === "upscale" ? 3 : 6), 1080, 1920], "a fixed dimension is not rewritten");
    }
});

test("a varint over one byte round-trips through the patch", async () => {
    const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, "upscale.onnx")));
    assert.deepEqual(readInputDims(patchInputDims(bytes, [2160, 3840]))[0], [1, 3, 2160, 3840]);
    assert.deepEqual(readInputDims(patchInputDims(bytes, [16, 300000]))[0], [1, 3, 16, 300000]);
});
