"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

// first-party dependencies
import { startDatabase, stopDatabase } from "../src/server/ws/database.js";
import { createJoin, attachJoin, detachJoins, releaseJoins, heldJoin, joinConnect, joinList, joinRename, joinRequest, joinAccept, joinReject, joinDelete, joinDisconnect, JOIN_NAME_MAX } from "../src/server/ws/handlers/joins.js";

// a remembered join is a row, so these run against a real SQLite file - which
// makes them the only cover database.js has as well
const buildDatabase = async function() {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ds-joins-")), "database.db");
    const db = await startDatabase({"ws": {"database": {"type": "sqlite", "host": file}}});
    return {"db": db, "file": file};
};

const dropDatabase = async function(db, file) {
    await stopDatabase(db);
    await fs.rm(path.dirname(file), {"recursive": true, "force": true});
};

// a client whose communicator keeps what the server said to it on its own
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

const buildServer = function(db, sessionIds = ["host", "peer", "other"]) {
    const clients = new Map();
    for (const sessionId of sessionIds) {
        clients.set(sessionId, buildClient());
    }
    // the same shape ServerWS carries: an accept puts two sockets in a room, so
    // a server built without that Map is not one these handlers can run against
    return {"clients": clients, "pairs": new Map(), "joins": new Map(), "rooms": new Map(), "db": db};
};

const buildCtx = function(server, sessionId, message = {}) {
    const answers = [];
    return {
        "message": message,
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

const pushesOf = function(server, sessionId, type) {
    return server.clients.get(sessionId).get("pushed").filter(function(message) {
        return message["type"] === type;
    });
};

// a join both sides are on, which is where pair-accept leaves them
const buildJoin = async function(db, isUnsupervised = false) {
    const server = buildServer(db);
    const join = await createJoin(server, isUnsupervised);
    attachJoin(server, "host", join, true);
    attachJoin(server, "peer", join, false);
    return {"server": server, "join": join};
};

//
// the row
//
test("createJoin writes a row with two codes that differ", async () => {
    const {db, file} = await buildDatabase();
    const server = buildServer(db);

    const join = await createJoin(server, false);
    assert.notEqual(join["peerCode"], join["hostCode"]);
    assert.equal(join["isUnsupervised"], false);

    const row = await db("joins").where("join_id", join["joinId"]).first();
    assert.equal(row["peer_code"], join["peerCode"]);
    assert.equal(row["host_code"], join["hostCode"]);

    await dropDatabase(db, file);
});

test("a join with no database behind it is not made", async () => {
    const server = buildServer(null);
    assert.equal(await createJoin(server, false), undefined);
});

//
// coming back
//
test("join-connect opens the row from either code and says which side it is", async () => {
    const {db, file} = await buildDatabase();
    const server = buildServer(db);
    const join = await createJoin(server, true);

    const hostCtx = buildCtx(server, "host", {"joinCode": join["hostCode"]});
    await joinConnect(hostCtx);
    assert.equal(hostCtx.answers[0]["isHost"], true);
    assert.equal(hostCtx.answers[0]["isUnsupervised"], true);
    assert.equal(hostCtx.answers[0]["isOnline"], false);      // nobody on the other side yet

    const peerCtx = buildCtx(server, "peer", {"joinCode": join["peerCode"]});
    await joinConnect(peerCtx);
    assert.equal(peerCtx.answers[0]["isHost"], false);
    assert.equal(peerCtx.answers[0]["isOnline"], true);       // the host is there now

    releaseJoins(server);
    await dropDatabase(db, file);
});

test("join-connect refuses a code no row holds", async () => {
    const {db, file} = await buildDatabase();
    const server = buildServer(db);

    const ctx = buildCtx(server, "peer", {"joinCode": "0000000000"});
    await joinConnect(ctx);
    assert.deepEqual(ctx.answers[0], {"success": false, "error": "unknown-join"});

    await dropDatabase(db, file);
});

test("join-list answers the joins this connection is on", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    const ctx = buildCtx(server, "host");
    joinList(ctx);
    assert.deepEqual(ctx.answers[0]["joins"], [{
        "joinId": join["joinId"],
        "isHost": true,
        "isUnsupervised": false,
        "isOnline": true
    }]);

    releaseJoins(server);
    await dropDatabase(db, file);
});

//
// the name
//
test("join-rename writes the caller's own column and leaves the other alone", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    const hostCtx = buildCtx(server, "host", {"joinId": join["joinId"], "name": "Laptop"});
    await joinRename(hostCtx);
    assert.equal(hostCtx.answers[0]["success"], true);
    assert.equal(hostCtx.answers[0]["name"], "Laptop");

    const peerCtx = buildCtx(server, "peer", {"joinId": join["joinId"], "name": "Office desktop"});
    await joinRename(peerCtx);
    assert.equal(peerCtx.answers[0]["success"], true);

    // the host named the peer, the peer named the host: two columns, and
    // neither side was told anything about the other's
    const row = await db("joins").where("join_id", join["joinId"]).first();
    assert.equal(row["peer_name"], "Laptop");
    assert.equal(row["host_name"], "Office desktop");
    assert.equal(pushesOf(server, "peer", "join-rename").length, 0);
    assert.equal(pushesOf(server, "host", "join-rename").length, 0);

    releaseJoins(server);
    await dropDatabase(db, file);
});

test("join-connect hands the name back to the side that wrote it", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    await joinRename(buildCtx(server, "host", {"joinId": join["joinId"], "name": "Laptop"}));

    const ctx = buildCtx(server, "host", {"joinCode": join["hostCode"]});
    await joinConnect(ctx);
    assert.equal(ctx.answers[0]["name"], "Laptop");

    const peerCtx = buildCtx(server, "peer", {"joinCode": join["peerCode"]});
    await joinConnect(peerCtx);
    assert.equal(peerCtx.answers[0]["name"], "");

    releaseJoins(server);
    await dropDatabase(db, file);
});

test("join-rename refuses a join this socket is not on, and a name that is not one", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    const strangerCtx = buildCtx(server, "other", {"joinId": join["joinId"], "name": "Laptop"});
    await joinRename(strangerCtx);
    assert.equal(strangerCtx.answers[0]["error"], "unknown-join");

    for (const name of [undefined, 7, "x".repeat(JOIN_NAME_MAX + 1)]) {
        const ctx = buildCtx(server, "host", {"joinId": join["joinId"], "name": name});
        await joinRename(ctx);
        assert.equal(ctx.answers[0]["error"], "invalid-name");
    }

    const row = await db("joins").where("join_id", join["joinId"]).first();
    assert.equal(row["peer_name"], "");

    releaseJoins(server);
    await dropDatabase(db, file);
});

//
// the ask
//
test("a supervised join asks the host again", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    const ctx = buildCtx(server, "peer", {"joinId": join["joinId"]});
    await joinRequest(ctx);

    assert.equal(ctx.answers[0]["success"], true);
    assert.equal(ctx.answers[0]["isAccepted"], false);
    assert.ok(ctx.answers[0]["timeout"] > 0);
    assert.equal(pushesOf(server, "host", "join-request").length, 1);

    // and the host saying yes reaches the one that asked
    const answerCtx = buildCtx(server, "host", {"joinId": join["joinId"]});
    joinAccept(answerCtx);
    assert.equal(answerCtx.answers[0]["success"], true);
    assert.equal(pushesOf(server, "peer", "join-accept").length, 1);

    releaseJoins(server);
    await dropDatabase(db, file);
});

test("an unsupervised join disturbs nobody", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db, true);

    const ctx = buildCtx(server, "peer", {"joinId": join["joinId"]});
    await joinRequest(ctx);

    assert.deepEqual(ctx.answers[0], {"success": true, "isAccepted": true});
    assert.equal(pushesOf(server, "host", "join-request").length, 0);

    releaseJoins(server);
    await dropDatabase(db, file);
});

test("a refused join stands, unlike a refused pair code", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    await joinRequest(buildCtx(server, "peer", {"joinId": join["joinId"]}));
    joinReject(buildCtx(server, "host", {"joinId": join["joinId"]}));

    const heard = pushesOf(server, "peer", "join-reject");
    assert.equal(heard.length, 1);
    assert.equal(heard[0]["reason"], "rejected");

    // the same device may ask again a moment later
    const againCtx = buildCtx(server, "peer", {"joinId": join["joinId"]});
    await joinRequest(againCtx);
    assert.equal(againCtx.answers[0]["success"], true);

    releaseJoins(server);
    await dropDatabase(db, file);
});

test("a host that is away cannot be asked", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    detachJoins(server, "host");
    const ctx = buildCtx(server, "peer", {"joinId": join["joinId"]});
    await joinRequest(ctx);
    assert.deepEqual(ctx.answers[0], {"success": false, "error": "offline"});

    releaseJoins(server);
    await dropDatabase(db, file);
});

test("a peer that goes away withdraws what it asked", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    await joinRequest(buildCtx(server, "peer", {"joinId": join["joinId"]}));
    detachJoins(server, "peer");

    assert.equal(pushesOf(server, "host", "join-cancel").length, 1);
    assert.equal(heldJoin(server, "peer", join["joinId"]), undefined);

    releaseJoins(server);
    await dropDatabase(db, file);
});

//
// forgetting it
//
test("join-delete drops the row and tells the other side", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    await joinDelete(buildCtx(server, "host", {"joinId": join["joinId"]}));

    assert.equal(pushesOf(server, "peer", "join-remove").length, 1);
    assert.equal(await db("joins").where("join_id", join["joinId"]).first(), undefined);
    assert.equal(server.joins.has(join["joinId"]), false);

    // and the code opens nothing now
    const ctx = buildCtx(server, "peer", {"joinCode": join["peerCode"]});
    await joinConnect(ctx);
    assert.equal(ctx.answers[0]["error"], "unknown-join");

    await dropDatabase(db, file);
});

test("join-disconnect takes the caller off its joins and keeps the row", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    const ctx = buildCtx(server, "peer");
    joinDisconnect(ctx);
    assert.deepEqual(ctx.answers, [{"success": true}]);

    // gone for the host, and not on the join itself any more
    assert.equal(pushesOf(server, "host", "join-online").at(-1)["isOnline"], false);
    assert.equal(heldJoin(server, "peer", join["joinId"]), undefined);
    assert.equal(server.clients.get("peer").has("joinIds"), false);

    // the row was not touched: the same code opens it again
    assert.notEqual(await db("joins").where("join_id", join["joinId"]).first(), undefined);
    const again = buildCtx(server, "peer", {"joinCode": join["peerCode"]});
    await joinConnect(again);
    assert.equal(again.answers[0]["success"], true);

    // and a socket on no join at all is answered the same
    const none = buildCtx(server, "other");
    joinDisconnect(none);
    assert.deepEqual(none.answers, [{"success": true}]);

    releaseJoins(server);
    await dropDatabase(db, file);
});

//
// who is there
//
test("a side coming online is pushed to the other one", async () => {
    const {db, file} = await buildDatabase();
    const server = buildServer(db);
    const join = await createJoin(server, false);

    // the host is first, and there is nobody to tell yet
    attachJoin(server, "host", join, true);
    assert.equal(pushesOf(server, "peer", "join-online").length, 0);

    attachJoin(server, "peer", join, false);
    const pushes = pushesOf(server, "host", "join-online");
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0]["joinId"], join["joinId"]);
    assert.equal(pushes[0]["isOnline"], true);

    releaseJoins(server);
    await dropDatabase(db, file);
});

test("only the edges are pushed, and the last socket leaving is one", async () => {
    const {db, file} = await buildDatabase();
    const server = buildServer(db, ["host", "peer", "peer-2"]);
    const join = await createJoin(server, false);
    attachJoin(server, "host", join, true);
    attachJoin(server, "peer", join, false);

    // a second window of the same device is not a second arrival
    attachJoin(server, "peer-2", join, false);
    assert.equal(pushesOf(server, "host", "join-online").length, 1);

    // nor is the first of them leaving a departure
    detachJoins(server, "peer");
    assert.equal(pushesOf(server, "host", "join-online").length, 1);

    detachJoins(server, "peer-2");
    const pushes = pushesOf(server, "host", "join-online");
    assert.equal(pushes.length, 2);
    assert.equal(pushes[1]["isOnline"], false);

    releaseJoins(server);
    await dropDatabase(db, file);
});
