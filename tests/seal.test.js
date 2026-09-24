"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { createKeys, deriveSeal, createReplayWindow, SEAL_HEADER, TAG_SIZE, REPLAY_WINDOW } from "../src/client/web/src/room/seal.js";

// The relay's seal is WebCrypto and nothing else, so it runs whole under Node.
// What has to be true is what the server must not be able to do with a relayed
// payload: read it, change it, send it twice, send it back to the side that
// sealed it, or put one of its own in its place.

const pairUp = async function() {
    const hostKeys = await createKeys();
    const peerKeys = await createKeys();
    return {
        "host": await deriveSeal(hostKeys, peerKeys["publicKey"], true),
        "peer": await deriveSeal(peerKeys, hostKeys["publicKey"], false),
        "hostKeys": hostKeys,
        "peerKeys": peerKeys
    };
};

const bytesOf = function(size, seed = 3) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        bytes[i] = (i * seed + 11) & 0xFF;
    }
    return bytes;
};

const contains = function(haystack, needle) {
    outer: for (let i = 0; i + needle.byteLength <= haystack.byteLength; i++) {
        for (let j = 0; j < needle.byteLength; j++) {
            if (haystack[i + j] !== needle[j]) {
                continue outer;
            }
        }
        return true;
    }
    return false;
};

test("bytes and messages cross both ways and come out as they went in", async function() {
    const {host, peer} = await pairUp();

    const frame = bytesOf(5000);
    const opened = await peer.open(await host.seal(frame.slice().buffer));
    assert.deepEqual(new Uint8Array(opened["data"]), frame);

    const message = {"kind": "input", "events": [{"type": "key", "code": "KeyA"}]};
    assert.deepEqual((await host.open(await peer.seal(message)))["data"], message);
});

test("the server sees the size and nothing else", async function() {
    const {host} = await pairUp();
    const secret = new TextEncoder().encode("hunter2-the-password-typed-on-the-host");
    const sealed = new Uint8Array(await host.seal({"kind": "clipboard-text", "text": new TextDecoder().decode(secret)}));
    assert.equal(contains(sealed, secret), false);

    // bytes and JSON look alike from outside: header, one kind byte, body, tag
    const frame = await host.seal(bytesOf(100).buffer);
    assert.equal(frame.byteLength, SEAL_HEADER + 1 + 100 + TAG_SIZE);
});

test("a changed byte anywhere does not open", async function() {
    const {host, peer} = await pairUp();
    const sealed = new Uint8Array(await host.seal(bytesOf(64).buffer));
    for (const at of [0, 1, SEAL_HEADER - 1, SEAL_HEADER, sealed.byteLength - 1]) {
        const changed = sealed.slice();
        changed[at] ^= 0x01;
        assert.equal(await peer.open(changed.buffer), undefined, "byte " + at);
    }
    // and the untouched one still does, since nothing above was marked
    assert.notEqual(await peer.open(sealed.buffer), undefined);
});

test("a payload opens once", async function() {
    const {host, peer} = await pairUp();
    const sealed = await host.seal({"kind": "keyframe"});
    assert.notEqual(await peer.open(sealed.slice(0)), undefined);
    assert.equal(await peer.open(sealed.slice(0)), undefined);
});

test("a payload handed back to the side that sealed it does not open", async function() {
    const {host} = await pairUp();
    const sealed = await host.seal({"kind": "control", "isControl": true});
    assert.equal(await host.open(sealed), undefined);
});

test("a room's payload does not open in another room", async function() {
    const first = await pairUp();
    const second = await pairUp();
    const sealed = await first.host.seal({"kind": "share-end"});
    assert.equal(await second.peer.open(sealed), undefined);
});

test("payloads that finish out of order still open, within the window", async function() {
    const {host, peer} = await pairUp();
    const sealed = [];
    for (let i = 0; i < 5; i++) {
        sealed.push(await host.seal({"n": i}));
    }
    for (const i of [3, 0, 4, 1, 2]) {
        assert.equal((await peer.open(sealed[i]))["data"]["n"], i);
    }
});

test("a payload older than the window is refused", async function() {
    const {host, peer} = await pairUp();
    const first = await host.seal({"n": 0});
    let last = null;
    for (let i = 1; i <= REPLAY_WINDOW; i++) {
        last = await host.seal({"n": i});
    }
    assert.equal((await peer.open(last))["data"]["n"], REPLAY_WINDOW);
    assert.equal(await peer.open(first), undefined);
});

test("the buffer handed to seal may be reused as soon as the call returns", async function() {
    const {host, peer} = await pairUp();
    const buffer = bytesOf(256).buffer;
    const sealing = host.seal(buffer);
    new Uint8Array(buffer).fill(0);
    assert.deepEqual(new Uint8Array((await peer.open(await sealing))["data"]), bytesOf(256));
});

test("a key that is not the other end's is refused", async function() {
    const keys = await createKeys();
    await assert.rejects(deriveSeal(keys, keys["publicKey"], true));
    await assert.rejects(deriveSeal(keys, "not base64 at all!", true));
    await assert.rejects(deriveSeal(keys, btoa("short"), true));
});

test("a key swapped on the way leaves the two ends unable to talk", async function() {
    // the server hands each end a key of its own in place of the other's: each
    // end pairs with the server, and neither end's payload opens at the other
    const hostKeys = await createKeys();
    const peerKeys = await createKeys();
    const middle = await createKeys();
    const host = await deriveSeal(hostKeys, middle["publicKey"], true);
    const peer = await deriveSeal(peerKeys, middle["publicKey"], false);
    assert.equal(await peer.open(await host.seal({"kind": "keyframe"})), undefined);
});

test("the replay window is moved only by what opened", function() {
    const replay = createReplayWindow(8);
    assert.equal(replay.isFresh(0), true);
    assert.equal(replay.mark(0), true);
    assert.equal(replay.mark(0), false);

    // asked about, never marked: a forged counter far ahead moves nothing
    assert.equal(replay.isFresh(1000), true);
    assert.equal(replay.mark(1), true);

    assert.equal(replay.mark(9), true);
    assert.equal(replay.isFresh(1), false);     // out of the window now
    assert.equal(replay.isFresh(2), true);      // the last one still in it
    assert.equal(replay.mark(5), true);
    assert.equal(replay.mark(5), false);

    assert.equal(replay.isFresh(-1), false);
    assert.equal(replay.isFresh(1.5), false);
});
