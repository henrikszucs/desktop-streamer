"use strict";

// the wire format of the stream: how one encoded frame is cut into the chunks a
// data channel carries and put back together at the other end. Pure functions
// and one small state machine, no DOM and no WebRTC in here, so tests/frame.test.js
// runs it under Node - what it decides and why is .claude/CLIENT.md, "The stream".
//
// Every chunk opens with the same 12 bytes:
//
//     u32 seq          one per encoded frame, wraps
//     u16 chunkIndex
//     u16 chunkCount
//     u8  flags        KEY | AUDIO | CONFIG, see below
//     u24 timestamp    microseconds mod 2^24, unwrapped at the far end
//
// and the bytes of the frame behind them. The header is what lets a chunk that
// arrives late, early or never be told apart from the ones around it.

const HEADER_SIZE = 12;

// what a frame is
const FLAG_KEY = 1;         // a keyframe: the decoder can start from it
const FLAG_AUDIO = 2;       // an audio frame rather than a video one
const FLAG_CONFIG = 4;      // a decoder configuration, JSON in the payload

const TIMESTAMP_MASK = 0xFFFFFF;

// how many frames may be in pieces at once before the oldest is given up on. An
// unordered channel reorders chunks by a few milliseconds, not by frames, so two
// is one more than a well behaved line ever needs.
const HOLD = 2;

// the difference between two sequence numbers as the sender counted them: the
// counter wraps at 2^32 and this stays right across the wrap
const seqDiff = function(a, b) {
    return (a - b) | 0;
};

// one frame into its chunks. chunkSize is the most a chunk may carry behind
// the header - Infinity puts the whole frame in one, which is what the relay
// takes, since the socket splits and reassembles on its own.
const packFrame = function(seq, flags, timestamp, payload, chunkSize = Infinity) {
    const bytes = (payload instanceof Uint8Array ? payload : new Uint8Array(payload));
    const size = (Number.isFinite(chunkSize) === true ? Math.max(1, Math.floor(chunkSize)) : bytes.byteLength);
    const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / size));
    if (chunkCount > 0xFFFF) {
        throw new Error("The frame is too large to chunk");
    }
    const stamp = Math.floor(timestamp) & TIMESTAMP_MASK;

    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
        const start = i * size;
        const end = Math.min(start + size, bytes.byteLength);
        const chunk = new Uint8Array(HEADER_SIZE + (end - start));
        const view = new DataView(chunk.buffer);
        view.setUint32(0, seq >>> 0);
        view.setUint16(4, i);
        view.setUint16(6, chunkCount);
        view.setUint8(8, flags & 0xFF);
        view.setUint8(9, (stamp >>> 16) & 0xFF);
        view.setUint16(10, stamp & 0xFFFF);
        chunk.set(bytes.subarray(start, end), HEADER_SIZE);
        chunks.push(chunk.buffer);
    }
    return chunks;
};

// the header of one chunk, or undefined for bytes that are not one
const readHeader = function(buffer) {
    if ((buffer instanceof ArrayBuffer) === false || buffer.byteLength < HEADER_SIZE) {
        return undefined;
    }
    const view = new DataView(buffer);
    const chunkIndex = view.getUint16(4);
    const chunkCount = view.getUint16(6);
    if (chunkCount === 0 || chunkIndex >= chunkCount) {
        return undefined;
    }
    return {
        "seq": view.getUint32(0),
        "chunkIndex": chunkIndex,
        "chunkCount": chunkCount,
        "flags": view.getUint8(8),
        "timestamp": (view.getUint8(9) << 16) | view.getUint16(10)
    };
};

// the two sides of a config frame: an object in, bytes out, and back
const packConfig = function(config) {
    return new TextEncoder().encode(JSON.stringify(config));
};
const readConfig = function(payload) {
    try {
        return JSON.parse(new TextDecoder().decode(payload));
    } catch (error) {
        return undefined;
    }
};

// the other end of packFrame. Chunks go in as they arrive, in whatever order,
// and a frame comes out of onFrame once - whole, and never after a later one.
//
// Three rules, and they are the whole of what makes an unreliable channel
// usable for a picture:
// - a frame that completes after a later one has already been delivered is
//   dropped: the decoder wants them in order, and it is late for good;
// - a frame still in pieces when HOLD newer ones have started is dropped: the
//   chunk that would finish it is not coming;
// - a dropped frame is reported, so the caller can wait for the next keyframe
//   and ask for one - a delta frame with a hole before it decodes to garbage.
const createReassembler = function(onFrame, onDrop = function() {}) {
    const pending = new Map();      // seq -> {header, parts, received, size}
    let newestSeq = null;           // the highest seq a chunk has arrived for
    let lastDelivered = null;       // the seq last handed out
    const clocks = new Map();       // FLAG_AUDIO or 0 -> the full timestamp last seen on that kind

    // the 24 bits on the wire back onto the clock the frames before it set: the
    // first frame of a kind is its clock, and each one after is the nearest
    // reading to the one before. Sound and picture are two clocks, since the
    // host stamps them from two sources.
    const unwrap = function(flags, stamp) {
        const kind = flags & FLAG_AUDIO;
        if (clocks.has(kind) === false) {
            clocks.set(kind, stamp);
            return stamp;
        }
        const last = clocks.get(kind);
        const delta = ((stamp - (last & TIMESTAMP_MASK)) << 8) >> 8;
        clocks.set(kind, last + delta);
        return last + delta;
    };

    const drop = function(seq) {
        const entry = pending.get(seq);
        pending.delete(seq);
        if (typeof entry !== "undefined") {
            onDrop({"seq": seq, "flags": entry["header"]["flags"]});
        }
    };

    const push = function(buffer) {
        const header = readHeader(buffer);
        if (typeof header === "undefined") {
            return;
        }
        const seq = header["seq"];

        // behind what was already handed out: nothing to do with it
        if (lastDelivered !== null && seqDiff(seq, lastDelivered) <= 0) {
            return;
        }

        let entry = pending.get(seq);
        if (typeof entry === "undefined") {
            entry = {
                "header": header,
                "parts": new Array(header["chunkCount"]).fill(null),
                "received": 0,
                "size": 0
            };
            pending.set(seq, entry);
            if (newestSeq === null || seqDiff(seq, newestSeq) > 0) {
                newestSeq = seq;
            }
            // whatever has fallen too far behind the newest is not finishing
            for (const heldSeq of [...pending.keys()]) {
                if (seqDiff(newestSeq, heldSeq) >= HOLD) {
                    drop(heldSeq);
                }
            }
            if (pending.has(seq) === false) {
                return;
            }
        }
        if (entry["parts"][header["chunkIndex"]] !== null) {
            return;         // the same chunk twice
        }
        const part = new Uint8Array(buffer, HEADER_SIZE);
        entry["parts"][header["chunkIndex"]] = part;
        entry["received"]++;
        entry["size"] += part.byteLength;
        if (entry["received"] < header["chunkCount"]) {
            return;
        }

        // whole: everything older still in pieces is late for good
        pending.delete(seq);
        for (const heldSeq of [...pending.keys()]) {
            if (seqDiff(heldSeq, seq) < 0) {
                drop(heldSeq);
            }
        }
        const timestamp = unwrap(header["flags"], header["timestamp"]);
        lastDelivered = seq;

        let payload;
        if (header["chunkCount"] === 1) {
            payload = entry["parts"][0];
        } else {
            payload = new Uint8Array(entry["size"]);
            let offset = 0;
            for (const piece of entry["parts"]) {
                payload.set(piece, offset);
                offset += piece.byteLength;
            }
        }
        onFrame({
            "seq": seq,
            "flags": header["flags"],
            "timestamp": timestamp,
            "payload": payload
        });
    };

    const reset = function() {
        pending.clear();
        newestSeq = null;
        lastDelivered = null;
        clocks.clear();
    };

    return {"push": push, "reset": reset};
};

export { HEADER_SIZE, FLAG_KEY, FLAG_AUDIO, FLAG_CONFIG, HOLD, packFrame, readHeader, packConfig, readConfig, createReassembler, seqDiff };
export default { HEADER_SIZE, FLAG_KEY, FLAG_AUDIO, FLAG_CONFIG, HOLD, packFrame, readHeader, packConfig, readConfig, createReassembler, seqDiff };
