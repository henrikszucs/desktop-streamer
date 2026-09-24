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
import { createJoin, attachJoin, detachJoins, detachUserJoins, releaseJoins, heldJoin, removeUserJoins, joinConnect, joinList, joinRename, joinRequest, joinAccept, joinReject, joinDelete, joinDisconnect, joinSync, JOIN_NAME_MAX } from "../src/server/ws/handlers/joins.js";
import { createRoom } from "../src/server/ws/handlers/rooms.js";

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

test("createJoin writes the peer's account on the row and never the host's", async () => {
    const {db, file} = await buildDatabase();
    const server = buildServer(db);

    const owned = await createJoin(server, false, "alice");
    const row = await db("joins").where("join_id", owned["joinId"]).first();
    assert.equal(row["peer_user_id"], "alice");
    assert.equal(row["host_user_id"], "");

    // a guest's device is nobody's, and so is one asked for with nonsense
    const guest = await createJoin(server, false);
    assert.equal((await db("joins").where("join_id", guest["joinId"]).first())["peer_user_id"], "");
    const odd = await createJoin(server, false, 42);
    assert.equal((await db("joins").where("join_id", odd["joinId"]).first())["peer_user_id"], "");

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

test("a room opened for a remembered device is not a new one", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    await joinRequest(buildCtx(server, "peer", {"joinId": join["joinId"]}));
    joinAccept(buildCtx(server, "host", {"joinId": join["joinId"]}));
    assert.equal(pushesOf(server, "host", "room-open")[0]["isNew"], false);
    assert.equal(pushesOf(server, "peer", "room-open")[0]["isNew"], false);

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

test("join-disconnect with ids takes the caller off those joins only", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);

    // the same socket is the host of a second join, the way one client is on
    // its shares and its devices at once
    const share = await createJoin(server, false);
    attachJoin(server, "peer", share, true);
    attachJoin(server, "other", share, false);

    const ctx = buildCtx(server, "peer", {"joinIds": [join["joinId"], "not-a-join"]});
    joinDisconnect(ctx);
    assert.deepEqual(ctx.answers, [{"success": true}]);

    // off the one named, and told so to its host
    assert.equal(heldJoin(server, "peer", join["joinId"]), undefined);
    assert.equal(pushesOf(server, "host", "join-online").at(-1)["isOnline"], false);

    // still on the other, whose peer heard nothing
    assert.notEqual(heldJoin(server, "peer", share["joinId"]), undefined);
    assert.equal(pushesOf(server, "other", "join-online").filter(function(message) {
        return message["isOnline"] === false;
    }).length, 0);
    assert.deepEqual([...server.clients.get("peer").get("joinIds")], [share["joinId"]]);

    releaseJoins(server);
    await dropDatabase(db, file);
});

//
// the devices of an account
//
test("join-sync hands an account its devices with their codes, and a guest nothing", async () => {
    const {db, file} = await buildDatabase();
    const server = buildServer(db);

    const mine = await createJoin(server, true, "alice");
    const theirs = await createJoin(server, false, "bob");
    const shared = await createJoin(server, false);      // a guest's
    await db("joins").where("join_id", mine["joinId"]).update({"host_name": "Office", "peer_name": "Laptop"});

    server.clients.get("peer").set("userId", "alice");
    const ctx = buildCtx(server, "peer");
    await joinSync(ctx);
    assert.equal(ctx.answers[0]["success"], true);
    assert.deepEqual(ctx.answers[0]["joins"], [{
        "joinId": mine["joinId"],
        "joinCode": mine["peerCode"],
        "name": "Office",           // what alice calls it, not what the host does
        "isUnsupervised": true
    }]);
    assert.equal(ctx.answers[0]["joins"].some(function(entry) {
        return entry["joinId"] === theirs["joinId"] || entry["joinId"] === shared["joinId"];
    }), false);

    // the code is what a client presents next, and it opens the peer side
    const connect = buildCtx(server, "peer", {"joinCode": ctx.answers[0]["joins"][0]["joinCode"]});
    await joinConnect(connect);
    assert.equal(connect.answers[0]["isHost"], false);

    // a guest has no account to be handed the devices of
    const guest = buildCtx(server, "other");
    await joinSync(guest);
    assert.deepEqual(guest.answers, [{"success": false, "error": "not-signed-in"}]);

    releaseJoins(server);
    await dropDatabase(db, file);
});

test("removeUserJoins drops every device of an account and tells each host", async () => {
    const {db, file} = await buildDatabase();
    const server = buildServer(db);

    const first = await createJoin(server, false, "alice");
    const second = await createJoin(server, false, "alice");
    const kept = await createJoin(server, false, "bob");
    attachJoin(server, "host", first, true);
    attachJoin(server, "peer", first, false);
    attachJoin(server, "other", kept, true);

    assert.equal(await removeUserJoins(server, "alice"), 2);

    assert.equal((await db("joins").whereIn("join_id", [first["joinId"], second["joinId"]])).length, 0);
    assert.notEqual(await db("joins").where("join_id", kept["joinId"]).first(), undefined);
    assert.equal(server.joins.has(first["joinId"]), false);
    assert.equal(server.clients.get("host").get("joinIds").has(first["joinId"]), false);

    // both sockets on it are told - the account is gone, so its own client
    // has no answer coming either
    assert.equal(pushesOf(server, "host", "join-remove").length, 1);
    assert.equal(pushesOf(server, "peer", "join-remove").length, 1);
    assert.equal(pushesOf(server, "other", "join-remove").length, 0);

    // nothing to do for a guest or for nonsense
    assert.equal(await removeUserJoins(server, ""), 0);
    assert.equal(await removeUserJoins(server, undefined), 0);

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

//
// what an account's device is worth without the account
//
test("join-connect opens an account's device only for a socket signed in as it", async () => {
    const {db, file} = await buildDatabase();
    const server = buildServer(db);
    const join = await createJoin(server, true, "alice");

    // a guest holding the code - one that got out, or one kept past a sign out
    const guest = buildCtx(server, "peer", {"joinCode": join["peerCode"]});
    await joinConnect(guest);
    assert.deepEqual(guest.answers[0], {"success": false, "error": "not-allowed"});
    assert.equal(heldJoin(server, "peer", join["joinId"]), undefined);

    // somebody else's account is no better
    server.clients.get("peer").set("userId", "bob");
    const bob = buildCtx(server, "peer", {"joinCode": join["peerCode"]});
    await joinConnect(bob);
    assert.equal(bob.answers[0]["error"], "not-allowed");

    // the account itself is let on
    server.clients.get("peer").set("userId", "alice");
    const alice = buildCtx(server, "peer", {"joinCode": join["peerCode"]});
    await joinConnect(alice);
    assert.equal(alice.answers[0]["success"], true);

    // and the host side is the machine's, whoever is signed in there
    const host = buildCtx(server, "host", {"joinCode": join["hostCode"]});
    await joinConnect(host);
    assert.equal(host.answers[0]["success"], true);
    assert.equal(host.answers[0]["isHost"], true);

    releaseJoins(server);
    await dropDatabase(db, file);
});

test("a socket that stops being the account is taken off its devices and out of their rooms", async () => {
    const {db, file} = await buildDatabase();
    const server = buildServer(db);
    const owned = await createJoin(server, true, "alice");
    const guests = await createJoin(server, false);
    server.clients.get("peer").set("userId", "alice");
    attachJoin(server, "host", owned, true);
    attachJoin(server, "peer", owned, false);
    attachJoin(server, "other", guests, true);
    attachJoin(server, "peer", guests, false);
    const room = createRoom(server, "host", "peer", owned["joinId"]);

    detachUserJoins(server, "peer", "alice");

    // off the account's device, which its host is told, and out of the room
    // made through it - on both sides, the peer's own client included
    assert.equal(heldJoin(server, "peer", owned["joinId"]), undefined);
    assert.equal(pushesOf(server, "host", "join-online").at(-1)["isOnline"], false);
    assert.equal(server.rooms.size, 0);
    assert.equal(pushesOf(server, "host", "room-close")[0]["roomKey"], room.get("hostKey"));
    assert.equal(pushesOf(server, "peer", "room-close")[0]["roomKey"], room.get("peerKey"));

    // and still on the guest's device, which was never the account's
    assert.notEqual(heldJoin(server, "peer", guests["joinId"]), undefined);

    releaseJoins(server);
    await dropDatabase(db, file);
});

//
// what is connected through a join goes with it
//
test("join-delete ends the room standing on the join, on both sides", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db, true);
    const room = createRoom(server, "host", "peer", join["joinId"]);

    await joinDelete(buildCtx(server, "host", {"joinId": join["joinId"]}));

    // the host asked, and its own client is told as well: the room it was
    // sharing in is gone, not merely the record behind it
    assert.equal(server.rooms.size, 0);
    assert.equal(pushesOf(server, "host", "room-close")[0]["reason"], "removed");
    assert.equal(pushesOf(server, "peer", "room-close")[0]["roomKey"], room.get("peerKey"));

    await dropDatabase(db, file);
});

test("join-disconnect ends the caller's rooms on the joins it leaves, and no others", async () => {
    const {db, file} = await buildDatabase();
    const {server, join} = await buildJoin(db);
    const kept = createRoom(server, "host", "other", "");      // a pairing nobody remembered
    createRoom(server, "host", "peer", join["joinId"]);

    joinDisconnect(buildCtx(server, "peer", {"joinIds": [join["joinId"]]}));

    assert.equal(pushesOf(server, "peer", "room-close").length, 1);
    assert.equal(pushesOf(server, "host", "room-close").length, 1);
    assert.equal(pushesOf(server, "other", "room-close").length, 0);
    assert.equal(server.rooms.get(kept.get("hostKey")), kept);

    releaseJoins(server);
    await dropDatabase(db, file);
});
