"use strict";

// The relay's end-to-end layer: what crosses the server when the two ends could
// not reach each other is sealed here, so the server carries it without being
// able to read it, change it, replay it or turn it round. WebCrypto alone - an
// ephemeral ECDH key per side per room, HKDF into one AES-GCM key per direction,
// a counter for the nonce - and the keys renewed from inside the seal while the
// room stands. Why, and what it does not cover, is .claude/CLIENT.md, "The relay
// is sealed".

// the curve both ends make their keys on, and the size of a public half raw
const CURVE = "P-256";
const PUBLIC_KEY_SIZE = 65;

// one sealed payload:
//
//   [0]      the version of this layout
//   [1..4]   the epoch, big-endian - which of the room's keys sealed it
//   [5..12]  the counter, big-endian - the nonce, and what the replay window reads
//   [13..]   the AES-GCM ciphertext and its 16 byte tag
//
// The header is the additional data, so no byte of it can be changed.
const SEAL_VERSION = 1;
const EPOCH_SIZE = 4;
const COUNTER_SIZE = 8;
const SEAL_HEADER = 1 + EPOCH_SIZE + COUNTER_SIZE;
const TAG_SIZE = 16;

// and what is inside it: one byte saying whether the rest is bytes, JSON, or
// the seal's own rekeying - so the server does not even learn which it is
const PAYLOAD_BYTES = 1;
const PAYLOAD_JSON = 2;
const PAYLOAD_REKEY = 3;

// how far behind the newest counter a payload may still arrive: relayed messages
// finish out of order (a keyframe is still being put together while the small
// ones sent after it arrive whole), so the window is wide rather than strict
const REPLAY_WINDOW = 1024;

// When the host renews the keys: after this much has been sealed and opened on
// its side, or this long, whichever comes first. Far inside what AES-GCM allows
// one key, and short enough that a key that got out is worth little for long.
const REKEY_BYTES = 1024 * 1024 * 1024;
const REKEY_INTERVAL = 60 * 60 * 1000;

// how long an offer goes unanswered before it is sent again: a relayed message
// can be dropped at a full socket, and a rekey that waits for nothing never ends
const REKEY_RETRY = 10000;

// how long the previous epoch's key is kept once the other end has moved on,
// for what it sealed before it did and is still on its way
const KEY_GRACE = 30000;

// the labels of the key schedule: the two directions, each its own key - so a
// payload the server hands back to the side that sealed it does not open - and
// the root the next epoch is chained from
const INFO_HOST = "desktop-streamer relay host to peer";
const INFO_PEER = "desktop-streamer relay peer to host";
const INFO_ROOT = "desktop-streamer relay root";

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

const concatBytes = function(...parts) {
    const total = parts.reduce(function(sum, part) {
        return sum + part.byteLength;
    }, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
    }
    return bytes;
};

// what one message is before it is sealed, and back
const packPayload = function(data, kind) {
    const isBinary = (data instanceof ArrayBuffer && kind !== PAYLOAD_REKEY);
    const body = (isBinary === true
        ? new Uint8Array(data)
        : new TextEncoder().encode(JSON.stringify(data)));
    const bytes = new Uint8Array(1 + body.byteLength);
    bytes[0] = kind ?? (isBinary === true ? PAYLOAD_BYTES : PAYLOAD_JSON);
    bytes.set(body, 1);
    return bytes;
};

// {"data"} for a message, {"rekey"} for the seal's own, undefined for neither
const readPayload = function(bytes) {
    if (bytes.byteLength < 1) {
        return undefined;
    }
    if (bytes[0] === PAYLOAD_BYTES) {
        return {"data": bytes.slice(1).buffer};
    }
    if (bytes[0] !== PAYLOAD_JSON && bytes[0] !== PAYLOAD_REKEY) {
        return undefined;
    }
    let parsed = undefined;
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(1)));
    } catch (error) {
        return undefined;
    }
    return (bytes[0] === PAYLOAD_JSON ? {"data": parsed} : {"rekey": parsed});
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

// the nonce of a counter: four zero bytes and the counter. One counter runs
// through every epoch of a direction, so a nonce never repeats under any key.
const nonceOf = function(counter) {
    const iv = new Uint8Array(12);
    new DataView(iv.buffer).setBigUint64(4, BigInt(counter));
    return iv;
};

// one ECDH pair: the private half never leaves WebCrypto
const createPair = async function() {
    const pair = await crypto.subtle.generateKey({"name": "ECDH", "namedCurve": CURVE}, false, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    return {"privateKey": pair.privateKey, "raw": raw};
};

// the other end's public half, checked for being one before it is used
const readPublicKey = function(text) {
    const raw = fromBase64(text);
    if (raw === null || raw.byteLength !== PUBLIC_KEY_SIZE || raw[0] !== 0x04) {
        throw new Error("Not a public key");
    }
    return raw;
};

const agree = async function(privateKey, otherRaw) {
    const other = await crypto.subtle.importKey("raw", otherRaw, {"name": "ECDH", "namedCurve": CURVE}, false, []);
    return await crypto.subtle.deriveBits({"name": "ECDH", "public": other}, privateKey, 256);
};

// One epoch's keys from a shared secret: this side's two directions and the
// root the next epoch is chained from.
const schedule = async function(secret, salt, isHost) {
    const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey", "deriveBits"]);
    const params = function(info) {
        return {"name": "HKDF", "hash": "SHA-256", "salt": salt, "info": new TextEncoder().encode(info)};
    };
    const derive = function(info, usage) {
        return crypto.subtle.deriveKey(params(info), base, {"name": "AES-GCM", "length": 256}, false, [usage]);
    };
    return {
        "root": new Uint8Array(await crypto.subtle.deriveBits(params(INFO_ROOT), base, 256)),
        "sendKey": await derive(isHost === true ? INFO_HOST : INFO_PEER, "encrypt"),
        "receiveKey": await derive(isHost === true ? INFO_PEER : INFO_HOST, "decrypt")
    };
};

// The salt of an epoch. The first is the two public keys in host-then-peer
// order, so a key swapped on the way derives a different pair; every later one
// is the root before it, the epoch and that exchange's two keys - so each epoch
// hangs from the one before it, and through them all from the first exchange.
const firstSalt = async function(hostRaw, peerRaw) {
    return await crypto.subtle.digest("SHA-256", concatBytes(hostRaw, peerRaw));
};

const epochSalt = async function(root, epoch, hostRaw, peerRaw) {
    const epochBytes = new Uint8Array(EPOCH_SIZE);
    new DataView(epochBytes.buffer).setUint32(0, epoch);
    return await crypto.subtle.digest("SHA-256", concatBytes(root, epochBytes, hostRaw, peerRaw));
};

// The keys at work, and their renewal. `seal` for what this side sends, `open`
// for what it receives; `seal` copies what it is handed before it returns, so
// the caller may reuse the buffer at once.
//
// A rekey is an ECDH exchange carried *inside* the seal - the host's offer and
// the peer's answer are sealed messages like any other, so the only public keys
// that ever cross in the clear are the first two. Only the host offers, so the
// two ends never offer at once. The peer answers under the old keys and moves
// its own sending onto the new ones at the host's first message in them; each
// side keeps the previous epoch's key for KEY_GRACE after the other end has
// moved, then lets it go. `transmit` is how the seal sends a message of its own:
// it is handed the promise of the sealed bytes.
const createSeal = function(first, isHost, options) {
    const transmit = options?.["transmit"] ?? function() {};
    const now = options?.["now"] ?? Date.now;
    const rekeyBytes = options?.["rekeyBytes"] ?? REKEY_BYTES;
    const rekeyInterval = options?.["rekeyInterval"] ?? REKEY_INTERVAL;
    const rekeyRetry = options?.["rekeyRetry"] ?? REKEY_RETRY;
    const keyGrace = options?.["keyGrace"] ?? KEY_GRACE;

    const replay = createReplayWindow();
    let sent = 0;

    let root = first["root"];
    let latest = 0;                 // the newest epoch this side has keys for
    let sendEpoch = 0;              // the one it seals with
    let sendKey = first["sendKey"];
    let otherEpoch = 0;             // the newest the other end has sealed with
    const receiveKeys = new Map([[0, first["receiveKey"]]]);
    let dropAt = -1;                // when the keys of epochs before otherEpoch go

    // the host's half: what it has carried since the last rekey, and its offer
    let carried = 0;
    let rekeyedAt = now();
    let offer = null;               // {epoch, privateKey, raw, sentAt, isDeriving}

    // the peer's half: the answer it gave, so a repeated offer gets the same one,
    // and the new sending key it holds until the host moves onto it
    let answer = null;              // {epoch, offerKey, raw}
    let nextSendKey = null;

    // one plaintext sealed under whatever this side is sending with *now*: the
    // key and the counter are taken before anything is awaited
    const sealPlain = function(plain) {
        if (sent >= Number.MAX_SAFE_INTEGER) {
            return Promise.reject(new Error("The relay's counter ran out"));
        }
        const counter = sent++;
        const header = new Uint8Array(SEAL_HEADER);
        header[0] = SEAL_VERSION;
        const view = new DataView(header.buffer);
        view.setUint32(1, sendEpoch);
        view.setBigUint64(1 + EPOCH_SIZE, BigInt(counter));

        return crypto.subtle.encrypt(
            {"name": "AES-GCM", "iv": nonceOf(counter), "additionalData": header},
            sendKey,
            plain
        ).then(function(cipher) {
            const sealed = new Uint8Array(SEAL_HEADER + cipher.byteLength);
            sealed.set(header, 0);
            sealed.set(new Uint8Array(cipher), SEAL_HEADER);
            return sealed.buffer;
        });
    };

    const say = function(message) {
        transmit(sealPlain(packPayload(message, PAYLOAD_REKEY)));
    };

    // the previous epoch's keys, once the other end has been past them long enough
    const tidy = function() {
        if (dropAt === -1 || now() < dropAt) {
            return;
        }
        for (const epoch of receiveKeys.keys()) {
            if (epoch < otherEpoch) {
                receiveKeys.delete(epoch);
            }
        }
        dropAt = -1;
    };

    //
    // the host's side of a rekey
    //
    const sendOffer = function() {
        if (offer === null || offer.raw === null || offer.isDeriving === true) {
            return;
        }
        offer.sentAt = now();
        say({"step": "offer", "epoch": offer.epoch, "key": toBase64(offer.raw)});
    };

    const startRekey = function() {
        const own = {"epoch": latest + 1, "privateKey": null, "raw": null, "sentAt": now(), "isDeriving": false};
        offer = own;
        createPair().then(function(made) {
            if (offer !== own) {
                return;
            }
            own.privateKey = made["privateKey"];
            own.raw = made["raw"];
            sendOffer();
        }).catch(function(error) {
            if (offer === own) {
                offer = null;
            }
            console.error("Cannot make a key to renew the relay's:", error);
        });
    };

    // Asked on every payload the host seals or opens, so a room with nothing
    // crossing is a room with nothing to renew. A new rekey waits for the other
    // end to be on the last one: three epochs are never live at once.
    const account = function(bytes) {
        if (isHost !== true) {
            return;
        }
        carried += bytes;
        if (offer !== null) {
            if (now() - offer.sentAt >= rekeyRetry) {
                sendOffer();
            }
            return;
        }
        if (otherEpoch !== latest) {
            return;
        }
        if (carried < rekeyBytes && now() - rekeyedAt < rekeyInterval) {
            return;
        }
        startRekey();
    };

    const onAnswer = async function(message) {
        const own = offer;
        if (own === null || own.raw === null || own.isDeriving === true || message["epoch"] !== own.epoch) {
            return;
        }
        own.isDeriving = true;
        try {
            const peerRaw = readPublicKey(message["key"]);
            const secret = await agree(own.privateKey, peerRaw);
            const next = await schedule(secret, await epochSalt(root, own.epoch, own.raw, peerRaw), true);
            if (offer !== own) {
                return;
            }
            root = next["root"];
            latest = own.epoch;
            receiveKeys.set(latest, next["receiveKey"]);
            sendEpoch = latest;
            sendKey = next["sendKey"];
            offer = null;
            carried = 0;
            rekeyedAt = now();
            // the first message under the new keys, so the peer moves onto them
            // even if the host has nothing else to say for a while
            say({"step": "confirm", "epoch": latest});
        } catch (error) {
            own.isDeriving = false;
            console.error("Cannot take the relay's new keys:", error);
        }
    };

    //
    // the peer's side
    //
    const onOffer = async function(message) {
        const epoch = message["epoch"];

        // an offer seen before: its answer went missing, so it goes again
        if (answer !== null && answer.epoch === epoch) {
            if (answer.offerKey === message["key"] && answer.raw !== null) {
                say({"step": "answer", "epoch": epoch, "key": toBase64(answer.raw)});
            }
            return;
        }
        if (epoch !== latest + 1) {
            return;
        }
        const own = {"epoch": epoch, "offerKey": message["key"], "raw": null};
        answer = own;
        try {
            const hostRaw = readPublicKey(message["key"]);
            const made = await createPair();
            const secret = await agree(made["privateKey"], hostRaw);
            const next = await schedule(secret, await epochSalt(root, epoch, hostRaw, made["raw"]), false);
            if (answer !== own) {
                return;
            }
            root = next["root"];
            latest = epoch;
            receiveKeys.set(epoch, next["receiveKey"]);
            nextSendKey = next["sendKey"];
            own.raw = made["raw"];
            // under the old keys still: the host has not got the new ones yet
            say({"step": "answer", "epoch": epoch, "key": toBase64(made["raw"])});
        } catch (error) {
            if (answer === own) {
                answer = null;
            }
            console.error("Cannot renew the relay's keys:", error);
        }
    };

    const onRekey = async function(message) {
        if (typeof message !== "object" || message === null || Number.isSafeInteger(message["epoch"]) === false) {
            return;
        }
        if (isHost === true && message["step"] === "answer") {
            await onAnswer(message);
        } else if (isHost !== true && message["step"] === "offer") {
            await onOffer(message);
        }
        // "confirm" says nothing open() has not already acted on
    };

    const seal = function(data) {
        try {
            tidy();
            const plain = packPayload(data);
            const sealing = sealPlain(plain);
            account(plain.byteLength);
            return sealing;
        } catch (error) {
            return Promise.reject(error);
        }
    };

    // the message, {"isControl": true} for the seal's own, or undefined for
    // anything that did not open: a payload the server made, changed, replayed
    // or sent back to the side that sealed it
    const open = async function(buffer) {
        if ((buffer instanceof ArrayBuffer) === false || buffer.byteLength < SEAL_HEADER + TAG_SIZE + 1) {
            return undefined;
        }
        const header = new Uint8Array(buffer.slice(0, SEAL_HEADER));
        if (header[0] !== SEAL_VERSION) {
            return undefined;
        }
        const view = new DataView(header.buffer);
        const epoch = view.getUint32(1);
        const wide = view.getBigUint64(1 + EPOCH_SIZE);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) {
            return undefined;
        }
        const counter = Number(wide);
        tidy();
        const key = receiveKeys.get(epoch);
        if (typeof key === "undefined" || replay.isFresh(counter) === false) {
            return undefined;
        }

        let plain = null;
        try {
            plain = new Uint8Array(await crypto.subtle.decrypt(
                {"name": "AES-GCM", "iv": nonceOf(counter), "additionalData": header},
                key,
                new Uint8Array(buffer, SEAL_HEADER)
            ));
        } catch (error) {
            return undefined;
        }
        // asked again: a copy of the same payload may have opened meanwhile
        if (replay.mark(counter) === false) {
            return undefined;
        }

        // the other end is on a newer epoch: the one before it has KEY_GRACE
        // left, and a peer that answered moves its own sending across now
        if (epoch > otherEpoch) {
            otherEpoch = epoch;
            dropAt = now() + keyGrace;
            if (isHost !== true && epoch === latest && sendEpoch < latest && nextSendKey !== null) {
                sendEpoch = latest;
                sendKey = nextSendKey;
                nextSendKey = null;
            }
        }
        account(plain.byteLength);

        const payload = readPayload(plain);
        if (typeof payload === "undefined") {
            return undefined;
        }
        // awaited, so an offer has been answered by the time it is reported
        if ("rekey" in payload) {
            await onRekey(payload["rekey"]);
            return {"isControl": true};
        }
        return payload;
    };

    return {
        "seal": seal,
        "open": open,

        // the epoch this side seals with, and the ones it can still open
        "getEpoch": function() {
            return sendEpoch;
        },
        "getReceiveEpochs": function() {
            return [...receiveKeys.keys()];
        }
    };
};

// this side's half for one room: what goes to the other end as a `key` signal
const createKeys = async function() {
    const made = await createPair();
    return {
        "privateKey": made["privateKey"],
        "publicKey": toBase64(made["raw"]),
        "raw": made["raw"]
    };
};

// Both halves in: epoch 0, and the seal that renews it from there. `options`
// is `transmit` - how the seal sends its own messages - and, for a test, the
// clock and the thresholds.
const deriveSeal = async function(keys, otherKey, isHost, options = {}) {
    const otherRaw = readPublicKey(otherKey);
    // this side's own key handed back is the server talking, not the other end
    if (isSameBytes(otherRaw, keys["raw"]) === true) {
        throw new Error("The other end's key is this side's own");
    }
    const secret = await agree(keys["privateKey"], otherRaw);
    const hostRaw = (isHost === true ? keys["raw"] : otherRaw);
    const peerRaw = (isHost === true ? otherRaw : keys["raw"]);
    const first = await schedule(secret, await firstSalt(hostRaw, peerRaw), isHost);
    return createSeal(first, isHost, options);
};

export { createKeys, deriveSeal, createReplayWindow, packPayload, readPayload, SEAL_HEADER, TAG_SIZE, REPLAY_WINDOW, REKEY_BYTES, REKEY_INTERVAL, REKEY_RETRY, KEY_GRACE };
export default { createKeys, deriveSeal, createReplayWindow, packPayload, readPayload, SEAL_HEADER, TAG_SIZE, REPLAY_WINDOW, REKEY_BYTES, REKEY_INTERVAL, REKEY_RETRY, KEY_GRACE };
