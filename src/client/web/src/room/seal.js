"use strict";

// The relay's end-to-end layer: what crosses the server when the two ends could
// not reach each other is sealed here, so the server carries it without being
// able to read it, change it, replay it or turn it round. WebCrypto alone - an
// ephemeral ECDH key per side per room, HKDF into one AES-GCM key per direction,
// a counter for the nonce. Why, and what it does not cover yet, is
// .claude/CLIENT.md, "The relay is sealed".

// the curve both ends make their key on, and the size of its public half raw
const CURVE = "P-256";
const PUBLIC_KEY_SIZE = 65;

// one sealed payload:
//
//   [0]      the version of this layout
//   [1..8]   the counter, big-endian - the nonce, and what the replay window reads
//   [9..]    the AES-GCM ciphertext and its 16 byte tag
//
// The header is the additional data, so neither byte of it can be changed.
const SEAL_VERSION = 1;
const COUNTER_SIZE = 8;
const SEAL_HEADER = 1 + COUNTER_SIZE;
const TAG_SIZE = 16;

// and what is inside it: one byte saying whether the rest is bytes or JSON, so
// the server does not even learn which of the two a relayed message is
const PAYLOAD_BYTES = 1;
const PAYLOAD_JSON = 2;

// how far behind the newest counter a payload may still arrive: relayed messages
// finish out of order (a keyframe is still being put together while the small
// ones sent after it arrive whole), so the window is wide rather than strict
const REPLAY_WINDOW = 1024;

// the two directions, each its own key - so a payload the server hands back to
// the side that sealed it does not open there
const INFO_HOST = "desktop-streamer relay host to peer";
const INFO_PEER = "desktop-streamer relay peer to host";

const toBase64 = function(bytes) {
    let text = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        text += String.fromCharCode(bytes[i]);
    }
    return btoa(text);
};

const fromBase64 = function(text) {
    if (typeof text !== "string") {
        return null;
    }
    try {
        const raw = atob(text);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
        }
        return bytes;
    } catch (error) {
        return null;
    }
};

const isSameBytes = function(a, b) {
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

// what one message is before it is sealed, and back
const packPayload = function(data) {
    const isBinary = (data instanceof ArrayBuffer);
    const body = (isBinary === true
        ? new Uint8Array(data)
        : new TextEncoder().encode(JSON.stringify(data)));
    const bytes = new Uint8Array(1 + body.byteLength);
    bytes[0] = (isBinary === true ? PAYLOAD_BYTES : PAYLOAD_JSON);
    bytes.set(body, 1);
    return bytes;
};

const readPayload = function(bytes) {
    if (bytes.byteLength < 1) {
        return undefined;
    }
    if (bytes[0] === PAYLOAD_BYTES) {
        return {"data": bytes.slice(1).buffer};
    }
    if (bytes[0] !== PAYLOAD_JSON) {
        return undefined;
    }
    try {
        return {"data": JSON.parse(new TextDecoder().decode(bytes.subarray(1)))};
    } catch (error) {
        return undefined;
    }
};

// Which counters have been opened: the newest, and a slot for each of the
// REPLAY_WINDOW before it. `isFresh` is asked before a payload is decrypted and
// `mark` only after it opened, so a forged counter cannot move the window.
const createReplayWindow = function(size = REPLAY_WINDOW) {
    const seen = new Uint8Array(size);
    let highest = -1;

    const isFresh = function(counter) {
        if (Number.isSafeInteger(counter) === false || counter < 0) {
            return false;
        }
        if (counter > highest) {
            return true;
        }
        if (highest - counter >= size) {
            return false;
        }
        return seen[counter % size] === 0;
    };

    const mark = function(counter) {
        if (isFresh(counter) === false) {
            return false;
        }
        if (counter > highest) {
            // the slots the window moves past belonged to counters that are
            // now too old to be asked about
            const steps = Math.min(counter - highest, size);
            for (let i = 1; i <= steps; i++) {
                seen[(highest + i) % size] = 0;
            }
            highest = counter;
        }
        seen[counter % size] = 1;
        return true;
    };

    return {
        "isFresh": isFresh,
        "mark": mark
    };
};

// the nonce of a counter: four zero bytes and the counter. A key is one
// direction of one room, so a counter never repeats under it.
const nonceOf = function(counter) {
    const iv = new Uint8Array(12);
    new DataView(iv.buffer).setBigUint64(4, BigInt(counter));
    return iv;
};

// the two keys at work: `seal` for what this side sends, `open` for what it
// receives. Both are async, and `seal` copies what it is handed before it
// returns, so the caller may reuse the buffer at once.
const createSeal = function(sendKey, receiveKey) {
    const replay = createReplayWindow();
    let sent = 0;

    const seal = async function(data) {
        const plain = packPayload(data);
        if (sent >= Number.MAX_SAFE_INTEGER) {
            throw new Error("The relay's counter ran out");
        }
        const counter = sent++;

        const header = new Uint8Array(SEAL_HEADER);
        header[0] = SEAL_VERSION;
        new DataView(header.buffer).setBigUint64(1, BigInt(counter));

        const cipher = new Uint8Array(await crypto.subtle.encrypt(
            {"name": "AES-GCM", "iv": nonceOf(counter), "additionalData": header},
            sendKey,
            plain
        ));
        const sealed = new Uint8Array(SEAL_HEADER + cipher.byteLength);
        sealed.set(header, 0);
        sealed.set(cipher, SEAL_HEADER);
        return sealed.buffer;
    };

    // the message, or undefined for anything that did not open: a payload the
    // server made, changed, replayed or sent back to the side that sealed it
    const open = async function(buffer) {
        if ((buffer instanceof ArrayBuffer) === false || buffer.byteLength < SEAL_HEADER + TAG_SIZE + 1) {
            return undefined;
        }
        const header = new Uint8Array(buffer.slice(0, SEAL_HEADER));
        if (header[0] !== SEAL_VERSION) {
            return undefined;
        }
        const wide = new DataView(header.buffer).getBigUint64(1);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) {
            return undefined;
        }
        const counter = Number(wide);
        if (replay.isFresh(counter) === false) {
            return undefined;
        }

        let plain = null;
        try {
            plain = await crypto.subtle.decrypt(
                {"name": "AES-GCM", "iv": nonceOf(counter), "additionalData": header},
                receiveKey,
                new Uint8Array(buffer, SEAL_HEADER)
            );
        } catch (error) {
            return undefined;
        }
        // asked again: a copy of the same payload may have opened meanwhile
        if (replay.mark(counter) === false) {
            return undefined;
        }
        return readPayload(new Uint8Array(plain));
    };

    return {
        "seal": seal,
        "open": open
    };
};

// this side's half for one room: the private key never leaves WebCrypto, and
// the public one is what goes to the other end as a `key` signal
const createKeys = async function() {
    const pair = await crypto.subtle.generateKey({"name": "ECDH", "namedCurve": CURVE}, false, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    return {
        "privateKey": pair.privateKey,
        "publicKey": toBase64(raw),
        "raw": raw
    };
};

// both halves in: the shared secret, and from it the two keys. The salt is the
// two public keys in host-then-peer order, so both ends derive from the same
// transcript and a key swapped on the way derives a different pair.
const deriveSeal = async function(keys, otherKey, isHost) {
    const otherRaw = fromBase64(otherKey);
    if (otherRaw === null || otherRaw.byteLength !== PUBLIC_KEY_SIZE || otherRaw[0] !== 0x04) {
        throw new Error("Not a public key");
    }
    // this side's own key handed back is the server talking, not the other end
    if (isSameBytes(otherRaw, keys["raw"]) === true) {
        throw new Error("The other end's key is this side's own");
    }
    const other = await crypto.subtle.importKey("raw", otherRaw, {"name": "ECDH", "namedCurve": CURVE}, false, []);
    const secret = await crypto.subtle.deriveBits({"name": "ECDH", "public": other}, keys["privateKey"], 256);

    const hostRaw = (isHost === true ? keys["raw"] : otherRaw);
    const peerRaw = (isHost === true ? otherRaw : keys["raw"]);
    const transcript = new Uint8Array(hostRaw.byteLength + peerRaw.byteLength);
    transcript.set(hostRaw, 0);
    transcript.set(peerRaw, hostRaw.byteLength);
    const salt = await crypto.subtle.digest("SHA-256", transcript);

    const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
    const derive = function(info, usage) {
        return crypto.subtle.deriveKey(
            {"name": "HKDF", "hash": "SHA-256", "salt": salt, "info": new TextEncoder().encode(info)},
            base,
            {"name": "AES-GCM", "length": 256},
            false,
            [usage]
        );
    };
    const sendKey = await derive(isHost === true ? INFO_HOST : INFO_PEER, "encrypt");
    const receiveKey = await derive(isHost === true ? INFO_PEER : INFO_HOST, "decrypt");
    return createSeal(sendKey, receiveKey);
};

export { createKeys, deriveSeal, createReplayWindow, packPayload, readPayload, SEAL_HEADER, TAG_SIZE, REPLAY_WINDOW };
export default { createKeys, deriveSeal, createReplayWindow, packPayload, readPayload, SEAL_HEADER, TAG_SIZE, REPLAY_WINDOW };
