"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { HEADER_SIZE, FLAG_KEY, FLAG_AUDIO, FLAG_CONFIG, HOLD, packFrame, readHeader, packConfig, readConfig, createReassembler, seqDiff } from "../src/client/web/src/room/frame.js";

// The stream's wire format is the one part of the client that is pure - bytes
// in, bytes out, no channel behind it - so it is the one part of the client the
// server's test runner can prove. What has to be true is what the plan says an
// unreliable channel needs: a frame comes out whole, in order, once, and one
// that cannot is dropped and said so.

const payloadOf = function(size, seed = 1) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        bytes[i] = (i * seed + 7) & 0xFF;
    }
    return bytes;
};

const isSame = function(a, b) {
    if (a.byteLength !== b.byteLength) {
        return false;
    }
    for (let i = 0; i < a.byteLength; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
};

const collect = function() {
    const frames = [];
    const drops = [];
    const reassembler = createReassembler(function(frame) {
        frames.push(frame);
    }, function(drop) {
        drops.push(drop);
    });
    return {"frames": frames, "drops": drops, "push": reassembler.push, "reset": reassembler.reset};
};

test("a frame is cut at the chunk size and every chunk carries the header", () => {
    const payload = payloadOf(40000);
    const chunks = packFrame(5, FLAG_KEY, 123456, payload, 16000);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].byteLength, HEADER_SIZE + 16000);
    assert.equal(chunks[2].byteLength, HEADER_SIZE + 8000);

    for (let i = 0; i < chunks.length; i++) {
        const header = readHeader(chunks[i]);
        assert.equal(header["seq"], 5);
        assert.equal(header["chunkIndex"], i);
        assert.equal(header["chunkCount"], 3);
        assert.equal(header["flags"], FLAG_KEY);
        assert.equal(header["timestamp"], 123456);
    }
});

test("an infinite chunk size is one chunk, which is what the relay sends", () => {
    const chunks = packFrame(1, 0, 0, payloadOf(100000));
    assert.equal(chunks.length, 1);
    assert.equal(readHeader(chunks[0])["chunkCount"], 1);
});

test("bytes that are not a chunk are not read as one", () => {
    assert.equal(readHeader(new ArrayBuffer(4)), undefined);
    assert.equal(readHeader("no"), undefined);
    const bad = packFrame(1, 0, 0, payloadOf(10))[0];
    new DataView(bad).setUint16(6, 0);          // a chunk count of nothing
    assert.equal(readHeader(bad), undefined);
});

test("a frame comes out whole, once, in the order it was cut", () => {
    const out = collect();
    const payload = payloadOf(50000, 3);
    for (const chunk of packFrame(9, FLAG_KEY, 1000, payload, 16000)) {
        out.push(chunk);
    }
    assert.equal(out.frames.length, 1);
    assert.equal(out.frames[0]["seq"], 9);
    assert.equal(out.frames[0]["flags"], FLAG_KEY);
    assert.equal(out.frames[0]["timestamp"], 1000);
    assert.equal(isSame(out.frames[0]["payload"], payload), true);
    assert.equal(out.drops.length, 0);
});

test("chunks arriving in any order still make the frame", () => {
    const out = collect();
    const payload = payloadOf(64000, 5);
    const chunks = packFrame(2, 0, 0, payload, 16000);
    for (const chunk of [chunks[3], chunks[0], chunks[2], chunks[1]]) {
        out.push(chunk);
    }
    assert.equal(out.frames.length, 1);
    assert.equal(isSame(out.frames[0]["payload"], payload), true);
});

test("the same chunk twice changes nothing", () => {
    const out = collect();
    const chunks = packFrame(2, 0, 0, payloadOf(20000), 16000);
    out.push(chunks[0]);
    out.push(chunks[0]);
    assert.equal(out.frames.length, 0);
    out.push(chunks[1]);
    assert.equal(out.frames.length, 1);
});

test("a frame that completes after a later one is dropped, not delivered late", () => {
    const out = collect();
    const first = packFrame(10, FLAG_KEY, 0, payloadOf(20000), 16000);
    const second = packFrame(11, 0, 0, payloadOf(20000), 16000);
    out.push(first[0]);
    out.push(second[0]);
    out.push(second[1]);            // 11 is whole while 10 is still missing a chunk
    assert.equal(out.frames.length, 1);
    assert.equal(out.frames[0]["seq"], 11);
    assert.equal(out.drops.length, 1);
    assert.equal(out.drops[0]["seq"], 10);
    assert.equal(out.drops[0]["flags"], FLAG_KEY);

    out.push(first[1]);             // the chunk that would have finished 10
    assert.equal(out.frames.length, 1);
});

test("a frame left in pieces is given up on once HOLD newer ones have started", () => {
    const out = collect();
    out.push(packFrame(20, 0, 0, payloadOf(20000), 16000)[0]);
    for (let seq = 21; seq < 21 + HOLD; seq++) {
        out.push(packFrame(seq, 0, 0, payloadOf(20000), 16000)[0]);
    }
    assert.equal(out.drops.length, 1);
    assert.equal(out.drops[0]["seq"], 20);
});

test("the timestamp unwraps across the 24 bit boundary", () => {
    const out = collect();
    const near = (1 << 24) - 1000;
    out.push(packFrame(1, 0, near, payloadOf(10))[0]);
    out.push(packFrame(2, 0, near + 5000, payloadOf(10))[0]);
    assert.equal(out.frames[0]["timestamp"], near);
    assert.equal(out.frames[1]["timestamp"], near + 5000);
});

test("the sequence number wraps and the order still holds", () => {
    assert.equal(seqDiff(0, 0xFFFFFFFF), 1);
    assert.equal(seqDiff(0xFFFFFFFF, 0), -1);

    const out = collect();
    out.push(packFrame(0xFFFFFFFF, 0, 0, payloadOf(10))[0]);
    out.push(packFrame(0, 0, 0, payloadOf(10))[0]);
    assert.equal(out.frames.length, 2);
    assert.equal(out.frames[1]["seq"], 0);
});

test("a config frame carries an object", () => {
    const config = {"codec": "avc1.640033", "codedWidth": 1920, "codedHeight": 1080};
    const out = collect();
    out.push(packFrame(1, FLAG_CONFIG, 0, packConfig(config))[0]);
    assert.equal(out.frames[0]["flags"] & FLAG_CONFIG, FLAG_CONFIG);
    assert.deepEqual(readConfig(out.frames[0]["payload"]), config);
    assert.equal(readConfig(payloadOf(5)), undefined);
});

test("reset forgets what was delivered so a new stream can start from any seq", () => {
    const out = collect();
    out.push(packFrame(500, FLAG_AUDIO, 0, payloadOf(10))[0]);
    out.reset();
    out.push(packFrame(3, 0, 0, payloadOf(10))[0]);
    assert.equal(out.frames.length, 2);
});
