"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { createRoom, closeRoom, detachRooms, releaseRooms, heldRoom, roomSignal, roomData, roomLeave, SIGNAL_MAX, DATA_MAX } from "../src/server/ws/handlers/rooms.js";

// a client whose communicator keeps what the server said to it on its own
const buildClient = function(isRelayAllowed = true) {
    const pushed = [];
    return new Map([
        ["pushed", pushed],

        // the connection carries what it may do, as ws.js writes it when the
        // socket is taken - the relay reads it from here and from nowhere else
        ["isRelayAllowed", isRelayAllowed],
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

const buildServer = function(sessionIds = ["host", "peer", "other"], guestAllowRelay = true) {
    const clients = new Map();
    for (const sessionId of sessionIds) {
        clients.set(sessionId, buildClient(guestAllowRelay));
    }
    return {
        "clients": clients,
        "pairs": new Map(),
        "joins": new Map(),
        "rooms": new Map(),
        "confPublic": {"permissions": {"guestAllowRelay": guestAllowRelay}}
    };
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

//
// the room an accept leaves behind
//
test("a room tells both sides which of them it is", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "join-1");

    const hostOpen = pushesOf(server, "host", "room-open")[0];
    const peerOpen = pushesOf(server, "peer", "room-open")[0];
    assert.equal(hostOpen["isHost"], true);
    assert.equal(peerOpen["isHost"], false);
    assert.equal(hostOpen["roomKey"], room.get("hostKey"));
    assert.equal(peerOpen["roomKey"], room.get("peerKey"));
    assert.equal(peerOpen["joinId"], "join-1");

    // and each is told its own key and never the other's
    assert.notEqual(room.get("hostKey"), room.get("peerKey"));
    assert.equal(hostOpen["peerKey"], undefined);
    assert.equal(peerOpen["hostKey"], undefined);

    // and both are in it, whichever way round it is asked
    assert.equal(heldRoom(server, "host", room.get("hostKey"))["isHost"], true);
    assert.equal(heldRoom(server, "peer", room.get("peerKey"))["isHost"], false);
    assert.equal(heldRoom(server, "other", room.get("hostKey")), undefined);

    releaseRooms(server);
});

// what the two keys are for: one of them is worth nothing in the other's hands
test("a room key opens its own side and no other", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");

    // the key of the side you are not is not a key at all here
    assert.equal(heldRoom(server, "peer", room.get("hostKey")), undefined);
    assert.equal(heldRoom(server, "host", room.get("peerKey")), undefined);

    // so a socket holding the far end's key cannot act with it
    const ctx = buildCtx(server, "peer", {"roomKey": room.get("hostKey"), "signal": {"kind": "description"}});
    roomSignal(ctx);
    assert.equal(ctx.answers[0]["error"], "unknown-room");
    assert.equal(pushesOf(server, "host", "room-signal").length, 0);
    assert.equal(pushesOf(server, "peer", "room-signal").length, 0);

    releaseRooms(server);
});

// and what crosses is addressed in the words the far end knows
test("a relayed message arrives under the receiver's own key", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");

    roomSignal(buildCtx(server, "peer", {"roomKey": room.get("peerKey"), "signal": {"kind": "candidate"}}));
    const atHost = pushesOf(server, "host", "room-signal")[0];
    assert.equal(atHost["roomKey"], room.get("hostKey"));

    roomData(buildCtx(server, "host", {"roomKey": room.get("hostKey"), "data": {"n": 1}}));
    const atPeer = pushesOf(server, "peer", "room-data")[0];
    assert.equal(atPeer["roomKey"], room.get("peerKey"));

    releaseRooms(server);
});

test("a room needs two sockets that are still there", () => {
    const server = buildServer();
    server.clients.delete("peer");
    assert.equal(createRoom(server, "host", "peer", ""), undefined);
    assert.equal(server.rooms.size, 0);
});

//
// the relay
//
test("a signal is carried to the other end and to nobody else", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");
    const peerKey = room.get("peerKey");

    const ctx = buildCtx(server, "peer", {"roomKey": peerKey, "signal": {"kind": "description"}});
    roomSignal(ctx);

    assert.equal(ctx.answers[0]["success"], true);
    const carried = pushesOf(server, "host", "room-signal");
    assert.equal(carried.length, 1);
    assert.deepEqual(carried[0]["signal"], {"kind": "description"});
    assert.equal(carried[0]["roomKey"], room.get("hostKey"));
    assert.equal(pushesOf(server, "peer", "room-signal").length, 0);
    assert.equal(pushesOf(server, "other", "room-signal").length, 0);

    releaseRooms(server);
});

test("a signal into a room the caller is not in goes nowhere", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");

    const ctx = buildCtx(server, "other", {"roomKey": room.get("peerKey"), "signal": {"kind": "candidate"}});
    roomSignal(ctx);
    assert.equal(ctx.answers[0]["error"], "unknown-room");
    assert.equal(pushesOf(server, "host", "room-signal").length, 0);

    const gone = buildCtx(server, "peer", {"roomKey": "no-such-room", "signal": {}});
    roomSignal(gone);
    assert.equal(gone.answers[0]["error"], "unknown-room");

    releaseRooms(server);
});

test("the envelope is checked even though the contents are not", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");
    const peerKey = room.get("peerKey");

    const notAnObject = buildCtx(server, "peer", {"roomKey": peerKey, "signal": "offer"});
    roomSignal(notAnObject);
    assert.equal(notAnObject.answers[0]["error"], "invalid-signal");

    const tooLarge = buildCtx(server, "peer", {"roomKey": peerKey, "signal": {"sdp": "x".repeat(SIGNAL_MAX)}});
    roomSignal(tooLarge);
    assert.equal(tooLarge.answers[0]["error"], "too-large");

    assert.equal(pushesOf(server, "host", "room-signal").length, 0);
    releaseRooms(server);
});

test("a signal to a socket that is gone says so", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");
    server.clients.delete("host");

    const ctx = buildCtx(server, "peer", {"roomKey": room.get("peerKey"), "signal": {}});
    roomSignal(ctx);
    assert.equal(ctx.answers[0]["error"], "offline");

    releaseRooms(server);
});

//
// the ways out
//
test("leaving tells the other side once and answers either way", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");

    const ctx = buildCtx(server, "peer", {"roomKey": room.get("peerKey")});
    roomLeave(ctx);

    assert.equal(ctx.answers[0]["success"], true);
    const closes = pushesOf(server, "host", "room-close");
    assert.equal(closes.length, 1);
    assert.equal(closes[0]["reason"], "left");
    assert.equal(pushesOf(server, "peer", "room-close").length, 0);   // it asked for it
    assert.equal(server.rooms.size, 0);

    // and the room is gone for both, so a second leave is not an error
    const again = buildCtx(server, "host", {"roomKey": room.get("hostKey")});
    roomLeave(again);
    assert.equal(again.answers[0]["success"], true);
    assert.equal(pushesOf(server, "peer", "room-close").length, 0);
});

test("a socket that goes takes its rooms with it", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");

    detachRooms(server, "host");

    assert.equal(server.rooms.size, 0);
    const closes = pushesOf(server, "peer", "room-close");
    assert.equal(closes.length, 1);
    assert.equal(closes[0]["reason"], "gone");
    assert.equal(server.clients.get("peer").get("roomKeys").size, 0);

    // the signal that was on its way has nowhere to go now
    const ctx = buildCtx(server, "peer", {"roomKey": room.get("peerKey"), "signal": {}});
    roomSignal(ctx);
    assert.equal(ctx.answers[0]["error"], "unknown-room");
});

test("closing a room twice notifies once", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");

    closeRoom(server, room, "left", "peer");
    closeRoom(server, room, "gone", "peer");
    assert.equal(pushesOf(server, "host", "room-close").length, 1);
    assert.equal(server.rooms.size, 0);
});

//
// the fallback
//
test("relayed data is carried to the other end and to nobody else", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");

    const ctx = buildCtx(server, "peer", {"roomKey": room.get("peerKey"), "data": {"hello": "host"}});
    roomData(ctx);

    assert.equal(ctx.answers[0]["success"], true);
    const carried = pushesOf(server, "host", "room-data");
    assert.equal(carried.length, 1);
    assert.deepEqual(carried[0]["data"], {"hello": "host"});
    assert.equal(carried[0]["roomKey"], room.get("hostKey"));
    assert.equal(pushesOf(server, "peer", "room-data").length, 0);
    assert.equal(pushesOf(server, "other", "room-data").length, 0);

    releaseRooms(server);
});

test("a server that does not carry data says so before anything else", () => {
    const server = buildServer(["host", "peer", "other"], false);
    const room = createRoom(server, "host", "peer", "");

    // and it is answered for a room that does not exist either, so a client
    // cannot tell the two apart by asking
    const ctx = buildCtx(server, "peer", {"roomKey": room.get("peerKey"), "data": {}});
    roomData(ctx);
    assert.equal(ctx.answers[0]["error"], "not-allowed");
    assert.equal(pushesOf(server, "host", "room-data").length, 0);

    const unknown = buildCtx(server, "peer", {"roomKey": "no-such-room", "data": {}});
    roomData(unknown);
    assert.equal(unknown.answers[0]["error"], "not-allowed");

    releaseRooms(server);
});

test("relayed data is bounded and belongs to a room the caller is in", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");
    const peerKey = room.get("peerKey");

    const outside = buildCtx(server, "other", {"roomKey": peerKey, "data": {}});
    roomData(outside);
    assert.equal(outside.answers[0]["error"], "unknown-room");

    const nothing = buildCtx(server, "peer", {"roomKey": peerKey});
    roomData(nothing);
    assert.equal(nothing.answers[0]["error"], "invalid-data");

    const tooLarge = buildCtx(server, "peer", {"roomKey": peerKey, "data": "x".repeat(DATA_MAX)});
    roomData(tooLarge);
    assert.equal(tooLarge.answers[0]["error"], "too-large");

    assert.equal(pushesOf(server, "host", "room-data").length, 0);
    releaseRooms(server);
});

test("relayed data to a socket that is gone says so", () => {
    const server = buildServer();
    const room = createRoom(server, "host", "peer", "");
    server.clients.delete("host");

    const ctx = buildCtx(server, "peer", {"roomKey": room.get("peerKey"), "data": {}});
    roomData(ctx);
    assert.equal(ctx.answers[0]["error"], "offline");

    releaseRooms(server);
});

test("the relay permission is the connection's own, not the server's at that moment", () => {
    const server = buildServer(["host", "peer", "other"], true);

    // this socket was taken by a server that did not allow the relay, whatever
    // the configuration object says now
    server.clients.get("peer").set("isRelayAllowed", false);
    const room = createRoom(server, "host", "peer", "");

    const refused = buildCtx(server, "peer", {"roomKey": room.get("peerKey"), "data": {"from": "peer"}});
    roomData(refused);
    assert.equal(refused.answers[0]["error"], "not-allowed");
    assert.equal(pushesOf(server, "host", "room-data").length, 0);

    // and the other end, taken while it was allowed, still may - the answer
    // belongs to the connection and not to the room the two of them share
    const allowed = buildCtx(server, "host", {"roomKey": room.get("hostKey"), "data": {"from": "host"}});
    roomData(allowed);
    assert.equal(allowed.answers[0]["success"], true);
    assert.equal(pushesOf(server, "peer", "room-data").length, 1);

    releaseRooms(server);
});
