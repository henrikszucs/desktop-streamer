"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { handleAPI, reject, handlers } from "../src/server/ws/api.js";

// the dispatch is the one thing between a socket and every handler group, and
// the rule it holds is that a call always *answers*: an aborted message sends
// nothing back, so the caller would sit out its whole interaction timeout for a
// type this server simply does not serve.

// what a communicator hands a handler, with what came back kept for the assertion
const buildMessage = function(data, isInvoke = true) {
    const messageObj = {
        "data": data,
        "isInvoke": isInvoke,
        "sent": [],
        "aborts": 0,
        "waits": 0,
        async wait() {
            this.waits++;
            return this;
        },
        send(answer) {
            this.sent.push(answer);
        },
        abort() {
            this.aborts++;
        }
    };
    return messageObj;
};

//
// the table
//
test("every group's types are merged into one table", () => {
    for (const type of ["conf-get", "ping", "session-get", "pair-create", "join-connect"]) {
        assert.equal(typeof handlers.get(type), "function", "no handler for " + type);
    }
});

test("no two groups claim the same type", () => {
    // buildHandlers throws at import time on a collision, so reaching this file
    // at all is half the check - the other half is that the table really is the
    // groups added up rather than the last one winning
    assert.equal(handlers.size > 10, true, "the table is too small to be every group");
});

//
// reject
//
test("reject answers an invoke rather than aborting it", () => {
    const messageObj = buildMessage({});
    reject(messageObj, "unknown-type");
    assert.deepEqual(messageObj.sent, [{"success": false, "error": "unknown-type"}]);
    assert.equal(messageObj.aborts, 0);
});

test("reject aborts a send, which has nothing to answer", () => {
    const messageObj = buildMessage({}, false);
    reject(messageObj, "unknown-type");
    assert.deepEqual(messageObj.sent, []);
    assert.equal(messageObj.aborts, 1);
});

//
// handleAPI
//
test("a known type reaches its handler with the one ctx object", async () => {
    let seen = null;
    const handler = function(ctx) {
        seen = ctx;
    };
    handlers.set("test-only-type", handler);
    try {
        const messageObj = buildMessage({"type": "test-only-type", "value": 7});
        const server = {"name": "server"};
        await handleAPI(messageObj, "session-1", server);

        assert.notEqual(seen, null, "the handler was never called");
        assert.deepEqual(Object.keys(seen).sort(), ["message", "messageObj", "server", "sessionId"]);
        assert.equal(seen["message"]["value"], 7);
        assert.equal(seen["sessionId"], "session-1");
        assert.equal(seen["server"], server);
        assert.equal(seen["messageObj"], messageObj);
    } finally {
        handlers.delete("test-only-type");
    }
});

test("the message is read to its end before it is looked at", async () => {
    const messageObj = buildMessage({"type": "ping"});
    await handleAPI(messageObj, "session-1", {});
    assert.equal(messageObj.waits, 1);
});

test("a type this server does not serve is answered, not aborted", async () => {
    const messageObj = buildMessage({"type": "no-such-call"});
    await handleAPI(messageObj, "session-1", {});
    assert.deepEqual(messageObj.sent, [{"success": false, "error": "unknown-type"}]);
    assert.equal(messageObj.aborts, 0);
});

test("a message that is not an object with a string type is answered too", async () => {
    for (const data of [undefined, null, "ping", 7, [], {}, {"type": 7}]) {
        const messageObj = buildMessage(data);
        await handleAPI(messageObj, "session-1", {});
        assert.deepEqual(messageObj.sent, [{"success": false, "error": "invalid-format"}], "for " + JSON.stringify(data ?? null));
    }
});

test("a handler that throws reaches the caller of handleAPI", async () => {
    handlers.set("test-only-throwing", function() {
        throw new Error("handler failed");
    });
    try {
        // ws.js terminates the socket on it rather than letting an unhandled
        // rejection end the process, so the throw has to arrive there
        await assert.rejects(async function() {
            await handleAPI(buildMessage({"type": "test-only-throwing"}), "session-1", {});
        }, /handler failed/);
    } finally {
        handlers.delete("test-only-throwing");
    }
});
