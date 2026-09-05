"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { generatePairCode, addPairCode, removePairCode, releasePairCodes, pairCreate, pairDelete, pairRequest, pairAccept, pairReject, PAIR_CODE_LENGTH } from "../src/server/ws/handlers/pairing.js";

// the pairing state a handler touches is two Maps on the server instance and the
// state Map of one client, so a stand-in for it is exactly that
const buildServer = function(sessionIds = ["session-1"], guestAllowShare = true, guestAllowJoin = true) {
    const clients = new Map();
    for (const sessionId of sessionIds) {
        clients.set(sessionId, buildClient());
    }
    return {
        "clients": clients,
        "pairs": new Map(),
        "confPublic": {
            "permissions": {
                "guestAllowShare": guestAllowShare,
                "guestAllowJoin": guestAllowJoin
            }
        }
    };
};

// a client whose communicator keeps what the server said to it on its own, which
// is where every half of the handshake that is not an answer goes
const buildClient = function() {
    const pushed = [];
    return new Map([
        ["pushed", pushed],
        ["ws", {"_socket": {"remoteAddress": "127.0.0.1"}}],
        ["com", {
            "send": function(message) {
                pushed.push(message);
                return {
                    "error": "",
                    "wait": async function() {
                        return this;
                    }
                };
            }
        }]
    ]);
};

// the ctx api.js hands a handler, with the answer kept for the assertion
const buildCtx = function(server, sessionId = "session-1") {
    const answers = [];
    return {
        "message": {},
        "messageObj": {
            "send": function(data) {
                answers.push(data);
            }
        },
        "sessionId": sessionId,
        "server": server,
        "answers": answers
    };
};

// what one client was told, by type
const pushesOf = function(server, sessionId, type) {
    return server.clients.get(sessionId).get("pushed").filter(function(message) {
        return message["type"] === type;
    });
};

// a host with a code and a peer waiting on it: the state every answer starts from
const buildRequest = async function() {
    const server = buildServer(["host", "peer", "other"]);
    const hostCtx = buildCtx(server, "host");
    pairCreate(hostCtx);
    const pairCode = hostCtx.answers[0]["pairCode"];

    const peerCtx = buildCtx(server, "peer");
    peerCtx.message["pairCode"] = pairCode;
    await pairRequest(peerCtx);

    return {"server": server, "pairCode": pairCode, "hostCtx": hostCtx, "peerCtx": peerCtx};
};

//
// generatePairCode
//
test("generatePairCode makes a six digit code", () => {
    const code = generatePairCode(new Map());
    assert.equal(code.length, PAIR_CODE_LENGTH);
    assert.match(code, /^[0-9]{6}$/);
});

test("generatePairCode never hands out a code that is live", () => {
    // the first draws are taken, so the search has to keep drawing
    let asked = 0;
    const taken = {
        "has": function() {
            asked++;
            return asked <= 3;
        }
    };
    assert.match(generatePairCode(taken), /^[0-9]{6}$/);
    assert.equal(asked, 4);

    // and a code the table already holds is never the answer
    const pairs = new Map();
    for (let i = 0; i < 200; i++) {
        const code = generatePairCode(pairs);
        assert.equal(pairs.has(code), false);
        pairs.set(code, new Map());
    }
});

test("generatePairCode gives up on a full code space instead of spinning", () => {
    const full = {
        "has": function() {
            return true;
        }
    };
    assert.equal(generatePairCode(full), undefined);
});

//
// the code of a connection
//
test("addPairCode remembers the code on both sides", () => {
    const server = buildServer();
    const code = addPairCode(server, "session-1");

    assert.equal(server.pairs.size, 1);
    assert.equal(server.pairs.get(code).get("hostSessionId"), "session-1");
    assert.equal(server.clients.get("session-1").get("pairCode"), code);

    releasePairCodes(server);
});

test("removePairCode drops the code from both sides", () => {
    const server = buildServer();
    addPairCode(server, "session-1");
    removePairCode(server, "session-1");

    assert.equal(server.pairs.size, 0);
    assert.equal(server.clients.get("session-1").has("pairCode"), false);
});

test("removePairCode is a no-op for a connection that holds no code", () => {
    const server = buildServer();
    removePairCode(server, "session-1");
    removePairCode(server, "session-unknown");
    assert.equal(server.pairs.size, 0);
});

test("releasePairCodes empties the table", () => {
    const server = buildServer(["session-1", "session-2"]);
    addPairCode(server, "session-1");
    addPairCode(server, "session-2");
    assert.equal(server.pairs.size, 2);

    releasePairCodes(server);
    assert.equal(server.pairs.size, 0);
});

//
// the calls
//
test("pair-create answers a code", () => {
    const server = buildServer();
    const ctx = buildCtx(server);
    pairCreate(ctx);

    const answer = ctx.answers[0];
    assert.equal(answer["success"], true);
    assert.match(answer["pairCode"], /^[0-9]{6}$/);
    assert.equal(server.pairs.has(answer["pairCode"]), true);

    releasePairCodes(server);
});

test("a code stands with no clock of its own", () => {
    // it goes when the host gives it back or the socket does, and a refusal is
    // what replaces one - nothing here counts down
    const server = buildServer();
    const code = addPairCode(server, "session-1");
    assert.equal(server.pairs.get(code).has("timeoutId"), false);
});

test("pair-create replaces the code of the connection rather than adding one", () => {
    const server = buildServer();
    const ctx = buildCtx(server);
    pairCreate(ctx);
    pairCreate(ctx);

    assert.equal(server.pairs.size, 1);
    assert.notEqual(ctx.answers[0]["pairCode"], ctx.answers[1]["pairCode"]);
    assert.equal(server.pairs.has(ctx.answers[0]["pairCode"]), false);

    releasePairCodes(server);
});

test("pair-create is refused when a guest may not share", () => {
    const server = buildServer(["session-1"], false);
    const ctx = buildCtx(server);
    pairCreate(ctx);

    assert.deepEqual(ctx.answers[0], {"success": false, "error": "not-allowed"});
    assert.equal(server.pairs.size, 0);
});

test("pair-delete gives the code back", () => {
    const server = buildServer();
    const ctx = buildCtx(server);
    pairCreate(ctx);
    pairDelete(ctx);

    assert.deepEqual(ctx.answers[1], {"success": true});
    assert.equal(server.pairs.size, 0);
    assert.equal(server.clients.get("session-1").has("pairCode"), false);
});

//
// the request
//
test("pair-request asks the host and answers how long it has", async () => {
    const {server, pairCode, peerCtx} = await buildRequest();

    const answer = peerCtx.answers[0];
    assert.equal(answer["success"], true);
    assert.ok(answer["timeout"] > 0);

    const asked = pushesOf(server, "host", "pair-request");
    assert.equal(asked.length, 1);
    assert.equal(asked[0]["timeout"], answer["timeout"]);
    assert.equal(asked[0]["details"]["ipAddress"], "127.0.0.1");
    assert.equal(server.pairs.get(pairCode).get("peerSessionId"), "peer");

    releasePairCodes(server);
});

test("pair-request refuses a code that is not one", async () => {
    const server = buildServer(["host", "peer"]);
    const hostCtx = buildCtx(server, "host");
    pairCreate(hostCtx);
    const pairCode = hostCtx.answers[0]["pairCode"];

    const cases = new Map([
        ["12ab", "invalid-code"],
        ["1234567", "invalid-code"],
        [pairCode.split("").reverse().join("") === pairCode ? "111111" : pairCode.split("").reverse().join(""), "unknown-code"]
    ]);
    for (const [code, error] of cases) {
        const ctx = buildCtx(server, "peer");
        ctx.message["pairCode"] = code;
        await pairRequest(ctx);
        assert.equal(ctx.answers[0]["error"], error, code);
    }

    // and the code of the host itself, which would pair a device with itself
    const ownCtx = buildCtx(server, "host");
    ownCtx.message["pairCode"] = pairCode;
    await pairRequest(ownCtx);
    assert.equal(ownCtx.answers[0]["error"], "own-code");

    releasePairCodes(server);
});

test("pair-request is refused while the host is deciding", async () => {
    const {server, pairCode} = await buildRequest();

    const otherCtx = buildCtx(server, "other");
    otherCtx.message["pairCode"] = pairCode;
    await pairRequest(otherCtx);

    assert.equal(otherCtx.answers[0]["error"], "busy");
    assert.equal(server.pairs.get(pairCode).get("peerSessionId"), "peer");

    releasePairCodes(server);
});

test("pair-request is refused when a guest may not join", async () => {
    const server = buildServer(["host", "peer"], true, false);
    const hostCtx = buildCtx(server, "host");
    pairCreate(hostCtx);

    const peerCtx = buildCtx(server, "peer");
    peerCtx.message["pairCode"] = hostCtx.answers[0]["pairCode"];
    await pairRequest(peerCtx);

    assert.deepEqual(peerCtx.answers[0], {"success": false, "error": "not-allowed"});

    releasePairCodes(server);
});

//
// the answer
//
test("pair-accept tells the peer and uses the code up", async () => {
    const {server, pairCode, hostCtx} = await buildRequest();

    const answerCtx = buildCtx(server, "host");
    pairAccept(answerCtx);

    assert.equal(answerCtx.answers[0]["success"], true);
    assert.equal(pushesOf(server, "peer", "pair-accept").length, 1);
    assert.equal(server.pairs.has(pairCode), false);
    assert.equal(server.clients.get("host").has("pairCode"), false);
    assert.equal(server.clients.get("peer").has("pairCode"), false);

    // and there is nothing left for a second answer to find
    const againCtx = buildCtx(server, "host");
    pairAccept(againCtx);
    assert.equal(againCtx.answers[0]["error"], "no-request");
    assert.equal(hostCtx.answers.length, 1);

    releasePairCodes(server);
});

test("a rejected code is replaced by a new one", async () => {
    const {server, pairCode} = await buildRequest();

    const answerCtx = buildCtx(server, "host");
    pairReject(answerCtx);

    assert.equal(answerCtx.answers[0]["success"], true);

    const heard = pushesOf(server, "peer", "pair-reject");
    assert.equal(heard.length, 1);
    assert.equal(heard[0]["reason"], "rejected");

    const renewed = pushesOf(server, "host", "pair-code");
    assert.equal(renewed.length, 1);
    assert.notEqual(renewed[0]["pairCode"], pairCode);

    // the refused number is worth nothing to whoever tried it
    assert.equal(server.pairs.has(pairCode), false);
    assert.equal(server.pairs.has(renewed[0]["pairCode"]), true);
    assert.equal(server.clients.get("host").get("pairCode"), renewed[0]["pairCode"]);

    releasePairCodes(server);
});

test("a peer that gives up leaves the code alone", async () => {
    const {server, pairCode} = await buildRequest();

    const cancelCtx = buildCtx(server, "peer");
    pairReject(cancelCtx);

    assert.equal(cancelCtx.answers[0]["success"], true);
    assert.equal(pushesOf(server, "host", "pair-cancel").length, 1);
    assert.equal(pushesOf(server, "host", "pair-code").length, 0);

    // nobody decided anything, so the host is still handing the same code out
    assert.equal(server.pairs.get(pairCode).has("peerSessionId"), false);
    assert.equal(server.clients.get("host").get("pairCode"), pairCode);

    releasePairCodes(server);
});

test("a host that goes away ends the wait", async () => {
    const {server, pairCode} = await buildRequest();

    removePairCode(server, "host");

    const heard = pushesOf(server, "peer", "pair-reject");
    assert.equal(heard.length, 1);
    assert.equal(heard[0]["reason"], "gone");
    assert.equal(server.pairs.has(pairCode), false);
    assert.equal(server.clients.get("peer").has("pairCode"), false);
});

test("a peer that goes away withdraws its request", async () => {
    const {server, pairCode} = await buildRequest();

    removePairCode(server, "peer");

    assert.equal(pushesOf(server, "host", "pair-cancel").length, 1);
    assert.equal(server.pairs.get(pairCode).has("peerSessionId"), false);

    releasePairCodes(server);
});
