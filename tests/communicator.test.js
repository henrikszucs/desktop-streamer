"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import Communicator from "../src/server/communicator.js";

// What the communicator does with input it did not produce itself. Every socket
// the server takes feeds its bytes straight into receive(), before anybody has
// signed in, so a frame that is short, stray or large is not a malformed call
// to answer - it is something the process has to survive, and hold only so much
// of.

// two communicators wired to each other, copying what crosses the way a socket
// would; the second answers whatever is asked with the size of what it got
const buildLine = async function(config = {}) {
    const ends = [
        new Communicator({"interactTimeout": 1500, "packetSize": 65536, "sendThreads": 64}),
        new Communicator({"interactTimeout": 1500, ...config})
    ];
    const wire = function(to) {
        return async function(data) {
            const copy = (data instanceof ArrayBuffer ? data.slice(0) : JSON.parse(JSON.stringify(data)));
            setTimeout(function() {
                to.receive(copy);
            }, 1);
        };
    };
    ends[0].configure({"sender": wire(ends[1])});
    ends[1].configure({"sender": wire(ends[0])});
    await Promise.all([ends[0].sideSync(), ends[1].sideSync()]);
    await Promise.all([ends[0].timeSync(), ends[1].timeSync()]);
    return ends;
};

const release = function(ends) {
    for (const end of ends) {
        end.release();
    }
};

// the warnings the refusals below are expected to log, kept off the output
const quietly = async function(t, fn) {
    t.mock.method(console, "warn", function() {});
    return await fn();
};

test("a binary frame shorter than its own header is ignored, not thrown", async function(t) {
    await quietly(t, async function() {
        const com = new Communicator({"sender": async function() {}});
        for (const bytes of [[0], [0, 0], [4, 0, 0, 0], [8, 0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0], [2, 0, 0, 0, 0]]) {
            await assert.doesNotReject(com.receive(new Uint8Array(bytes).buffer));
        }
    });
});

test("a side sync reply nobody is waiting for is ignored, not thrown", async function(t) {
    await quietly(t, async function() {
        const com = new Communicator({"sender": async function() {}});
        await assert.doesNotReject(com.receive([2, Date.now() % 4294967295, com.UID, 5]));
    });
});

test("a JSON frame flagged as split is refused, since a JSON message is one packet", async function(t) {
    await quietly(t, async function() {
        const incoming = [];
        const com = new Communicator({"sender": async function() {}});
        com.onIncoming(function(messageObj) {
            incoming.push(messageObj);
        });
        await com.receive([8, Date.now() % 4294967295, 1, 0, 65535, {"filler": "x".repeat(1000)}]);
        assert.equal(incoming.length, 0);
        assert.equal(com.messages.size, 0);
    });
});

test("a message past maxReceiveBytes is refused, the sender told, and the bytes let go", async function(t) {
    await quietly(t, async function() {
        const ends = await buildLine({"maxReceiveBytes": 1024 * 1024});
        try {
            let incomingError = null;
            ends[1].onIncoming(async function(messageObj) {
                await messageObj.wait();
                incomingError = messageObj.error;
            });
            const big = ends[0].send(new ArrayBuffer(3 * 1024 * 1024));
            await big.wait();
            assert.equal(big.error, "reject");
            assert.equal(incomingError, "abort");
            assert.equal(ends[1].receiveBytes, 0);

            // and one under the limit crosses whole afterwards
            ends[1].onIncoming(async function(messageObj) {
                await messageObj.wait();
                if (messageObj.isInvoke === true) {
                    messageObj.send({"size": messageObj.data.byteLength});
                }
            });
            const small = ends[0].invoke(new ArrayBuffer(512 * 1024));
            await small.wait();
            assert.equal(small.error, "");
            assert.deepEqual(small.data, {"size": 512 * 1024});
            assert.equal(ends[1].receiveBytes, 0);
        } finally {
            release(ends);
        }
    });
});
