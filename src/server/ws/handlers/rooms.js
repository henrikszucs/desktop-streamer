"use strict";

// what an accepted request leaves behind: the room the two sockets are in, and
// the signaling carried across it.
//
// The server never sees a picture. It carries SDP and ICE between the two ends
// and nothing else, so what a signal *is* stays between the clients - which is
// why this file validates the envelope and not the contents.
//
// A room is the one thing that ties two sockets together after an answer. A pair
// that was not remembered leaves no join behind, so without this there would be
// nothing left of it a moment later; a join is the way *back* in, not the thing
// two devices are in now. It lives in memory only and dies with either socket:
// there is nothing in a half-negotiated connection worth keeping.

// first-party dependencies
import { generateId } from "../../common.js";
import { notify, pushData } from "../notify.js";

const ROOM_ID_LENGTH = 10;
const ROOM_ID_ATTEMPTS = 100;

// a signal is opaque, but it is not unbounded: a relay that carries anything of
// any size is a way to push anything of any size at somebody else's socket. An
// offer with a video codec list in it is a few kilobytes.
const SIGNAL_MAX = 16 * 1024;

// What one relayed *message* may weigh, and why the binary frame below exists.
//
// The communicator splits an ArrayBuffer into packets and reassembles it at the
// other end, so a binary frame has no size to stay under. A JSON message is not
// split - it goes as one frame - so the call that carries one is for the small
// things two ends say to each other, and this is the line between "a message"
// and "something that should have been sent as data".
const DATA_MAX = 64 * 1024;

// The binary relay frame: what a payload of any size travels as.
//
//   [0]      the frame kind - 1 for bytes, 2 for a JSON payload
//   [1..10]  the room id, one byte per character
//   [11..]   the payload, whatever the two ends put there
//
// The header is read by the server to know where to send it and by the other
// client to know what it is - the same bytes for both, so the frame is
// forwarded exactly as it arrived and nothing is copied or rebuilt on the way.
// The kind is not the server's business beyond being one it knows: what a
// payload *is* stays between the two clients, as everything else in a room does.
// The client half of this is buildRoomFrame/readRoomFrame in
// src/client/web/src/server.js and has to match byte for byte.
const FRAME_DATA = 1;
const FRAME_JSON = 2;
const FRAME_KINDS = new Set([FRAME_DATA, FRAME_JSON]);
const FRAME_HEADER = 1 + ROOM_ID_LENGTH;

const generateRoomId = function(server) {
    for (let i = 0; i < ROOM_ID_ATTEMPTS; i++) {
        const roomId = generateId(ROOM_ID_LENGTH);
        if (server.rooms.has(roomId) === false) {
            return roomId;
        }
    }
    return undefined;
};

// the rooms one socket is in, so its close can find them
const roomIdsOf = function(server, sessionId) {
    const client = server.clients.get(sessionId);
    if (client === undefined) {
        return undefined;
    }
    if (client.has("roomIds") === false) {
        client.set("roomIds", new Set());
    }
    return client.get("roomIds");
};

// Both sides are *told* about the room rather than handed it in an answer, and
// they are told the same way whoever said yes: the host that accepts a request
// gets one, and so does the host of an unsupervised join, which is never asked
// anything at all. One message, one path through the client - see src/room.js.
const createRoom = function(server, hostSessionId, peerSessionId, joinId = "") {
    const hostRooms = roomIdsOf(server, hostSessionId);
    const peerRooms = roomIdsOf(server, peerSessionId);
    if (hostRooms === undefined || peerRooms === undefined) {
        return undefined;       // a socket went while the answer was being sent
    }

    const roomId = generateRoomId(server);
    if (roomId === undefined) {
        return undefined;
    }

    /*{
        "roomId", "hostSessionId", "peerSessionId", "joinId"
    }*/
    const room = new Map([
        ["roomId", roomId],
        ["hostSessionId", hostSessionId],
        ["peerSessionId", peerSessionId],
        ["joinId", joinId]
    ]);
    server.rooms.set(roomId, room);
    hostRooms.add(roomId);
    peerRooms.add(roomId);

    // which side a socket is on is what decides who offers, so it is told rather
    // than worked out from what it happens to remember about the flow
    notify(server, hostSessionId, {"type": "room-open", "roomId": roomId, "joinId": joinId, "isHost": true});
    notify(server, peerSessionId, {"type": "room-open", "roomId": roomId, "joinId": joinId, "isHost": false});
    return room;
};

// the room a socket is in, from the memory table alone, and which side it is on
const heldRoom = function(server, sessionId, roomId) {
    const room = server.rooms.get(roomId);
    if (room === undefined) {
        return undefined;
    }
    if (room.get("hostSessionId") === sessionId) {
        return {"room": room, "isHost": true};
    }
    if (room.get("peerSessionId") === sessionId) {
        return {"room": room, "isHost": false};
    }
    return undefined;
};

const otherSessionId = function(room, isHost) {
    return room.get(isHost === true ? "peerSessionId" : "hostSessionId");
};

// What this connection may spend the server's bandwidth on, as it was answered
// when the socket was taken (ws.js). It is cached there rather than resolved
// here for one reason: the relay carries a message at a time and this is asked
// once per message, so a permission that has to be walked - or worse, read from
// a row - costs more than the thing it is guarding. Nothing changes it while a
// connection is live, so nothing has to re-read it.
//
// A socket that carries no answer is refused: the flag is written when the
// client state is built, so its absence is a client this server did not take.
const isRelayAllowed = function(server, sessionId) {
    return server.clients.get(sessionId)?.get("isRelayAllowed") === true;
};

// a room ends for both when it ends for one - there is no room with one side in
// it - and whoever did not ask for the ending is told why
const closeRoom = function(server, room, reason, exceptSessionId) {
    const roomId = room.get("roomId");
    if (server.rooms.delete(roomId) === false) {
        return;     // already closed, by the other side or by the same socket
    }
    for (const sessionId of [room.get("hostSessionId"), room.get("peerSessionId")]) {
        server.clients.get(sessionId)?.get("roomIds")?.delete(roomId);
        if (sessionId === exceptSessionId) {
            continue;
        }
        notify(server, sessionId, {"type": "room-close", "roomId": roomId, "reason": reason});
    }
};

// one socket leaves every room it is in. Called from the close handler: the
// connection it was negotiating cannot be finished without it, and the other end
// is waiting on a message that is not coming.
const detachRooms = function(server, sessionId) {
    const roomIds = server.clients.get(sessionId)?.get("roomIds");
    if (roomIds === undefined) {
        return;
    }
    for (const roomId of new Set(roomIds)) {
        const room = server.rooms.get(roomId);
        if (room === undefined) {
            continue;
        }
        closeRoom(server, room, "gone", sessionId);
    }
};

// the whole table, for a server that is stopping
const releaseRooms = function(server) {
    server.rooms.clear();
};

//
// the calls
//
// Both relayed calls are the same four questions - is this socket in that room,
// is the payload one of these, is it small enough, is the other end still there
// - and differ only in what they carry and what it may weigh. The differences
// are the descriptors below; this is the shape they are asked in.
const relayTo = function(ctx, relay) {
    const server = ctx["server"];
    const message = ctx["message"];
    const held = heldRoom(server, ctx["sessionId"], message["roomId"]);
    if (held === undefined) {
        ctx["messageObj"].send({"success": false, "error": "unknown-room"});
        return;
    }

    const payload = message[relay["field"]];
    if (relay["isValid"](payload) === false) {
        ctx["messageObj"].send({"success": false, "error": relay["invalidError"]});
        return;
    }
    if (JSON.stringify(payload).length > relay["max"]) {
        ctx["messageObj"].send({"success": false, "error": "too-large"});
        return;
    }

    const targetSessionId = otherSessionId(held["room"], held["isHost"]);
    if (server.clients.has(targetSessionId) === false) {
        ctx["messageObj"].send({"success": false, "error": "offline"});
        return;
    }

    notify(server, targetSessionId, {
        "type": relay["type"],
        "roomId": held["room"].get("roomId"),
        [relay["field"]]: payload
    });
    ctx["messageObj"].send({"success": true});
};

// an SDP or a candidate: an object, and one small enough to be one
const SIGNAL_RELAY = {
    "type": "room-signal",
    "field": "signal",
    "invalidError": "invalid-signal",
    "max": SIGNAL_MAX,
    "isValid": function(payload) {
        return typeof payload === "object" && payload !== null;
    }
};

// whatever the two ends are saying to each other: anything at all, as long as
// it is something
const DATA_RELAY = {
    "type": "room-data",
    "field": "data",
    "invalidError": "invalid-data",
    "max": DATA_MAX,
    "isValid": function(payload) {
        return typeof payload !== "undefined";
    }
};

// one signal to the other end of a room. This is the whole relay: it is not a
// conversation the server holds open, it is one message carried across, so a
// negotiation is as many of these as the two ends need and the server is holding
// nothing between them.
const roomSignal = function(ctx) {
    /*{
        "roomId": string,
        "signal": object        (opaque: the SDP or the candidate)
    }*/
    /*{
        "success": boolean,
        "error": string
    }*/
    relayTo(ctx, SIGNAL_RELAY);
};

// either side is done with it. Leaving a room somebody else already left is not
// an error - the room is gone either way, which is what the caller wanted.
const roomLeave = function(ctx) {
    /*{
        "roomId": string
    }*/
    /*{
        "success": boolean
    }*/
    const server = ctx["server"];
    const held = heldRoom(server, ctx["sessionId"], ctx["message"]["roomId"]);
    if (held !== undefined) {
        closeRoom(server, held["room"], "left", ctx["sessionId"]);
    }
    ctx["messageObj"].send({"success": true});
};

// The fallback: the two ends could not reach each other, so what would have
// crossed between them crosses the server instead.
//
// It is the signaling relay again - one message at a time, the server holding
// nothing and reading nothing of what it carries - but it is not the same cost:
// signaling is a handful of messages and this is the whole conversation, for as
// long as it lasts. That is what `guestAllowRelay` is for, and why it is off
// until a configuration says otherwise.
const roomData = function(ctx) {
    /*{
        "roomId": string,
        "data": any             (opaque: whatever the two ends are saying)
    }*/
    /*{
        "success": boolean,
        "error": string
    }*/
    // the answer this connection was given when it was taken, not a lookup, and
    // asked before the room is: what is refused here is the caller, not the room
    if (isRelayAllowed(ctx["server"], ctx["sessionId"]) === false) {
        ctx["messageObj"].send({"success": false, "error": "not-allowed"});
        return;
    }
    relayTo(ctx, DATA_RELAY);
};

// The other way in: a frame rather than a call.
//
// It is one route and not a table because a binary message has no room for a
// type field the dispatch could read - it says what it is in its first byte,
// which is what the frame layout above is for. api.js hands every binary message
// here, and anything this does not recognise is dropped: there is no answer to
// send back on a one-way frame, and a caller that gets one wrong is not waiting
// for one.
const roomFrame = function(ctx) {
    const server = ctx["server"];
    const buffer = ctx["message"];
    if (buffer.byteLength <= FRAME_HEADER) {
        return;         // a header with nothing behind it
    }

    const header = new Uint8Array(buffer, 0, FRAME_HEADER);
    if (FRAME_KINDS.has(header[0]) === false) {
        return;
    }
    let roomId = "";
    for (let i = 1; i < FRAME_HEADER; i++) {
        roomId += String.fromCharCode(header[i]);
    }

    // the same three questions the call above asks, in the same order
    if (isRelayAllowed(server, ctx["sessionId"]) === false) {
        return;
    }
    const held = heldRoom(server, ctx["sessionId"], roomId);
    if (held === undefined) {
        return;
    }

    pushData(server, otherSessionId(held["room"], held["isHost"]), buffer);
};

// the types this group answers
const handlers = {
    "room-signal": roomSignal,
    "room-data": roomData,
    "room-leave": roomLeave
};

export { handlers, createRoom, closeRoom, detachRooms, releaseRooms, heldRoom, otherSessionId, isRelayAllowed, roomSignal, roomData, roomFrame, roomLeave, SIGNAL_MAX, DATA_MAX, FRAME_DATA, FRAME_JSON, FRAME_HEADER };
export default handlers;
