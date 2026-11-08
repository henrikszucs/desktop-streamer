"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// first-party dependencies
import { createBits, createSliceReader } from "../src/client/web/src/room/stream-h264.js";

// The slice header reader is pure - an access unit's bytes in, the frame's QP,
// type and loop filter out - so it is held to real streams: the host's x264 and
// NVENC lines, and an x264 stream with what neither of them writes (B frames,
// weighted prediction, reordered references, two slices at two QPs). Every
// expected value is ffmpeg's trace_headers, a reader that is not this one; the
// command that made each stream is in fixtures/h264/expected.json.

const FIXTURES = new URL("./fixtures/h264/", import.meta.url);
const NAL_AUD = 9;

// a stream file as the access units the host's splitter cuts it into: one
// from each delimiter to the next
const accessUnits = function(bytes) {
    const cuts = [];
    for (let i = 0; i + 3 < bytes.length; i++) {
        if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
            if ((bytes[i + 3] & 0x1F) === NAL_AUD) {
                cuts.push(i > 0 && bytes[i - 1] === 0 ? i - 1 : i);
            }
            i += 2;
        }
    }
    return cuts.map(function(cut, k) {
        return bytes.subarray(cut, (k + 1 < cuts.length ? cuts[k + 1] : bytes.length));
    });
};

const expected = JSON.parse(await readFile(new URL("expected.json", FIXTURES), "utf8"));

for (const [name, stream] of Object.entries(expected)) {
    test("every frame of the " + name + " stream reads as trace_headers reads it", async function() {
        const units = accessUnits(new Uint8Array(await readFile(new URL(name + ".h264", FIXTURES))));
        assert.equal(units.length, stream["frames"].length);
        const reader = createSliceReader();
        units.forEach(function(unit, i) {
            const picture = reader.read(unit);
            const want = stream["frames"][i];
            assert.notEqual(picture, null, "frame " + i);
            assert.ok(Math.abs(picture["qp"] - want["qp"]) < 1e-3, "frame " + i + ": QP " + picture["qp"] + ", not " + want["qp"]);
            assert.equal(picture["type"], want["type"], "frame " + i);
            assert.equal(picture["isDeblocked"], want["isDeblocked"], "frame " + i);
            assert.equal(picture["slices"], want["slices"], "frame " + i);
        });
    });
}

test("the host lines differ where the upscaler needs to know: x264 without the loop filter, NVENC with it", function() {
    for (const frame of expected["x264"]["frames"]) {
        assert.equal(frame["isDeblocked"], false);
    }
    for (const frame of expected["nvenc"]["frames"]) {
        assert.equal(frame["isDeblocked"], true);
    }
});

test("a frame is read only once its parameter sets have been, as a decoder joining late", async function() {
    const units = accessUnits(new Uint8Array(await readFile(new URL("x264.h264", FIXTURES))));
    const reader = createSliceReader();
    assert.equal(reader.read(units[1]), null);
    assert.notEqual(reader.read(units[0]), null);
    assert.notEqual(reader.read(units[1]), null);
    reader.reset();
    assert.equal(reader.read(units[2]), null);
});

test("an ArrayBuffer reads as its bytes do, as the worker is handed one", async function() {
    const units = accessUnits(new Uint8Array(await readFile(new URL("nvenc.h264", FIXTURES))));
    const reader = createSliceReader();
    const key = units[0].slice();
    assert.deepEqual(reader.read(key.buffer), createSliceReader().read(units[0]));
});

test("what is not a stream reads as nothing, and does not throw", function() {
    const reader = createSliceReader();
    assert.equal(reader.read(new Uint8Array(0)), null);
    assert.equal(reader.read(new Uint8Array([0, 0, 1])), null);
    assert.equal(reader.read(new Uint8Array([0, 0, 1, 0x67, 0xFF, 0xFF, 0, 0, 1, 0x65, 0x88])), null);
    const noise = new Uint8Array(4096);
    for (let i = 0; i < noise.length; i++) {
        noise[i] = (i * 2654435761) >>> 24;
    }
    assert.doesNotThrow(function() {
        reader.read(noise);
    });
});

test("the bit reader drops the emulation prevention byte and reads Exp-Golomb codes", function() {
    // 00 00 03 01: the 03 is not data, so 24 bits are 00 00 01
    assert.equal(createBits(new Uint8Array([0, 0, 3, 1]), 0).u(24), 1);
    // an 03 not after two zeros is data
    assert.equal(createBits(new Uint8Array([0, 3, 1]), 0).u(24), 0x000301);
    // 1 | 010 | 011 | 00100 | 00101 = ue 0, 1, 2, 3, 4 = se 0, 1, -1, 2, -2
    const bytes = new Uint8Array([0b10100110, 0b01000010, 0b10000000]);
    const ue = createBits(bytes, 0);
    assert.deepEqual([ue.ue(), ue.ue(), ue.ue(), ue.ue(), ue.ue()], [0, 1, 2, 3, 4]);
    const se = createBits(bytes, 0);
    assert.deepEqual([se.se(), se.se(), se.se(), se.se(), se.se()], [0, 1, -1, 2, -2]);
    assert.throws(function() {
        createBits(new Uint8Array([0]), 0).u(9);
    }, RangeError);
});
