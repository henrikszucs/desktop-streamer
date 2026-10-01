"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { createClipboard, MAX_LENGTH } from "../src/client/web/src/room/clipboard.js";

// The shared clipboard is the one part of the room's clipboard that is neither
// a socket nor a browser permission dialog: what is worth sending, what is not
// worth sending twice, and what to do with a write the shell refused. The
// desktop shell's clipboard is two synchronous calls, so a fake one is enough
// to run the whole of it under Node - the browser path is the same code behind
// the same two calls.

const fakeDesktop = function(text = "") {
    const state = {"text": text, "reads": 0, "writes": 0, "isRefusing": false};
    const ctx = {
        "desktop": {
            "isAvailable": true,
            "clipboard": {
                "readText": function() {
                    state["reads"]++;
                    if (state["isRefusing"] === true) {
                        throw new Error("no clipboard");
                    }
                    return state["text"];
                },
                "writeText": function(value) {
                    state["writes"]++;
                    if (state["isRefusing"] === true) {
                        throw new Error("no clipboard");
                    }
                    state["text"] = value;
                }
            }
        }
    };
    return {"ctx": ctx, "state": state};
};

test("a browser with no clipboard has none to share", () => {
    const clipboard = createClipboard({});
    assert.equal(clipboard.isAvailable(), false);
    assert.equal(createClipboard(fakeDesktop().ctx).isAvailable(), true);
});

test("what is on it is news once, and never its own echo", async () => {
    const fake = fakeDesktop("first");
    const clipboard = createClipboard(fake.ctx);

    assert.deepEqual(await clipboard.take(), {"text": "first", "error": ""});
    assert.deepEqual(await clipboard.take(), {"text": null, "error": ""});

    fake.state["text"] = "second";
    assert.deepEqual(await clipboard.take(), {"text": "second", "error": ""});

    // what the other machine sent is on this clipboard because of the other
    // machine, so it is not something this one has to send back
    await clipboard.put("from the other end");
    assert.equal(fake.state["text"], "from the other end");
    assert.deepEqual(await clipboard.take(), {"text": null, "error": ""});
});

test("priming is reading without reporting", async () => {
    const fake = fakeDesktop("already there");
    const clipboard = createClipboard(fake.ctx);
    await clipboard.prime();
    assert.deepEqual(await clipboard.take(), {"text": null, "error": ""});
    fake.state["text"] = "copied since";
    assert.deepEqual(await clipboard.take(), {"text": "copied since", "error": ""});
});

test("an empty clipboard is nothing to send", async () => {
    const fake = fakeDesktop("");
    const clipboard = createClipboard(fake.ctx);
    assert.deepEqual(await clipboard.take(), {"text": null, "error": ""});
});

test("a shell that will not be read says so, rather than saying nothing", async () => {
    const fake = fakeDesktop("something");
    fake.state["isRefusing"] = true;
    const clipboard = createClipboard(fake.ctx);
    assert.deepEqual(await clipboard.take(), {"text": null, "error": "refused"});
});

test("more than the relay carries is refused at both ends, once", async () => {
    const fake = fakeDesktop("x".repeat(MAX_LENGTH + 1));
    const clipboard = createClipboard(fake.ctx);

    assert.deepEqual(await clipboard.take(), {"text": null, "error": "too-large"});
    // and the next tick is not the same complaint again
    assert.deepEqual(await clipboard.take(), {"text": null, "error": ""});

    const put = await clipboard.put("y".repeat(MAX_LENGTH + 1));
    assert.deepEqual(put, {"isDone": false, "error": "too-large"});
    assert.equal(fake.state["writes"], 0);
});

test("a refused write is kept for the next gesture", async () => {
    const fake = fakeDesktop("here");
    const clipboard = createClipboard(fake.ctx);

    fake.state["isRefusing"] = true;
    assert.deepEqual(await clipboard.put("from the other end"), {"isDone": false, "error": "pending"});

    fake.state["isRefusing"] = true;
    assert.equal(await clipboard.flush(), false);

    fake.state["isRefusing"] = false;
    assert.equal(await clipboard.flush(), true);
    assert.equal(fake.state["text"], "from the other end");

    // and it is flushed once: there is nothing left to write
    fake.state["text"] = "something else";
    assert.equal(await clipboard.flush(), true);
    assert.equal(fake.state["text"], "something else");
});

test("a new room knows nothing of the last one", async () => {
    const fake = fakeDesktop("same text");
    const clipboard = createClipboard(fake.ctx);

    assert.deepEqual(await clipboard.take(), {"text": "same text", "error": ""});
    assert.deepEqual(await clipboard.take(), {"text": null, "error": ""});

    clipboard.forget();
    assert.deepEqual(await clipboard.take(), {"text": "same text", "error": ""});
});
