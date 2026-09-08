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

// What a room is *held* by, and why there are two of them.
//
// A room has one identity and two credentials: the host is given one key, the
// peer another, and neither is ever told the other's. Everything a socket does
// to a room it does by presenting its own key, and the key names the side as
// much as the room - so a key that gets out (a log, a screenshot, the other end
// of a connection, a client that keeps more than it should) can only ever do
// the half its holder was already doing. One shared id would have made every
// leak a leak of both halves.
//
// The key alone is not the whole check: the socket presenting it still has to
// be the side that was given it (heldRoom below). The split is what keeps the
// two halves apart if that check ever has to loosen - a host reconnecting onto
// a second socket, say - and what keeps the *far end* from holding a credential
// it could act with.
const ROOM_KEY_LENGTH = 10;
const ROOM_KEY_ATTEMPTS = 100;

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
//   [1..10]  the sender's own room key, one byte per character
//   [11..]   the payload, whatever the two ends put there
//
// The header is read by the server to know where to send it and by the other
// client to know which room it belongs to - but *not* as the same ten bytes:
// each side knows the room by its own key, so the server writes the far end's
// key over the sender's before forwarding. It is ten bytes in place, the
// payload behind them untouched and nothing copied, and it is what keeps the
// frame from handing one side the other's credential. The kind is not the
// server's business beyond being one it knows: what a payload *is* stays
// between the two clients, as everything else in a room does. The client half
// of this is buildRoomFrame/readRoomFrame in src/client/web/src/server.js and
// has to match byte for byte.
const FRAME_DATA = 1;
const FRAME_JSON = 2;
const FRAME_KINDS = new Set([FRAME_DATA, FRAME_JSON]);
const FRAME_HEADER = 1 + ROOM_KEY_LENGTH;

// one key, unique among every key of every room that stands - both sides of a
// room live in the same table, so a key names a room and a side in one lookup
const generateRoomKey = function(server, taken = "") {
    for (let i = 0; i < ROOM_KEY_ATTEMPTS; i++) {
        const roomKey = generateId(ROOM_KEY_LENGTH);
        if (server.rooms.has(roomKey) === false && roomKey !== taken) {
            return roomKey;
        }
    }
    return undefined;
};

// the keys one socket holds, so its close can find the rooms they open. Its own
// only: a socket is never given the key of the side it is talking to.
const roomKeysOf = function(server, sessionId) {
    const client = server.clients.get(sessionId);
    if (client === undefined) {
        return undefined;
    }
    if (client.has("roomKeys") === false) {
        client.set("roomKeys", new Set());
    }
    return client.get("roomKeys");
};

// Both sides are *told* about the room rather than handed it in an answer, and
// they are told the same way whoever said yes: the host that accepts a request
// gets one, and so does the host of an unsupervised join, which is never asked
// anything at all. One message, one path through the client - see src/room.js.
const createRoom = function(server, hostSessionId, peerSessionId, joinId = "") {
    const hostRooms = roomKeysOf(server, hostSessionId);
    const peerRooms = roomKeysOf(server, peerSessionId);
    if (hostRooms === undefined || peerRooms === undefined) {
        return undefined;       // a socket went while the answer was being sent
    }

    // one room, two keys - see the note on ROOM_KEY_LENGTH above
    const hostKey = generateRoomKey(server);
    const peerKey = generateRoomKey(server, hostKey);
    if (hostKey === undefined || peerKey === undefined) {
        return undefined;
    }

    /*{
        "hostKey", "peerKey", "hostSessionId", "peerSessionId", "joinId"
    }*/
    const room = new Map([
        ["hostKey", hostKey],
        ["peerKey", peerKey],
        ["hostSessionId", hostSessionId],
        ["peerSessionId", peerSessionId],
        ["joinId", joinId]
    ]);

    // the same room under both keys: the table answers "which room, and which
    // side of it" in one lookup, and a room is only ever taken out of it by both
    server.rooms.set(hostKey, room);
    server.rooms.set(peerKey, room);
    hostRooms.add(hostKey);
    peerRooms.add(peerKey);

    // which side a socket is on is what decides who offers, so it is told rather
    // than worked out from what it happens to remember about the flow - and it
    // is told its own key and never the other's
    notify(server, hostSessionId, {"type": "room-open", "roomKey": hostKey, "joinId": joinId, "isHost": true});
    notify(server, peerSessionId, {"type": "room-open", "roomKey": peerKey, "joinId": joinId, "isHost": false});
    return room;
};

// The room a key opens, and the side of it the key is for.
//
// Two things are asked and both have to hold: the key is one this server handed
// out, and the socket presenting it is the side it was handed to. The first
// makes a guessed key worthless, the second makes a *stolen* one worthless to
// anybody but its owner - and because the two sides have different keys, the
// far end of a room holds nothing it could present here at all.
const heldRoom = function(server, sessionId, roomKey) {
    const room = server.rooms.get(roomKey);
    if (room === undefined) {
        return undefined;
    }
    const isHost = (room.get("hostKey") === roomKey);
    if (room.get(isHost === true ? "hostSessionId" : "peerSessionId") !== sessionId) {
        return undefined;
    }
    return {"room": room, "isHost": isHost, "roomKey": roomKey};
};

const otherSessionId = function(room, isHost) {
    return room.get(isHost === true ? "peerSessionId" : "hostSessionId");
};

// what the other side knows this room by, which is what anything carried across
// has to arrive under: the far end has never seen the sender's key and would
// not recognise it, and handing it over is the one thing the split is against
const otherRoomKey = function(room, isHost) {
    return room.get(isHost === true ? "peerKey" : "hostKey");
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
    // the host key is what says whether this room is still standing: both keys
    // go in together and come out together, so one of them answers for both
    if (server.rooms.delete(room.get("hostKey")) === false) {
        return;     // already closed, by the other side or by the same socket
    }
    server.rooms.delete(room.get("peerKey"));

    for (const isHost of [true, false]) {
        const sessionId = room.get(isHost === true ? "hostSessionId" : "peerSessionId");
        const roomKey = room.get(isHost === true ? "hostKey" : "peerKey");

        server.clients.get(sessionId)?.get("roomKeys")?.delete(roomKey);
        if (sessionId === exceptSessionId) {
            continue;
        }
        // each side hears about the room in the only words it knows it by
        notify(server, sessionId, {"type": "room-close", "roomKey": roomKey, "reason": reason});
    }
};

// one socket leaves every room it is in. Called from the close handler: the
// connection it was negotiating cannot be finished without it, and the other end
// is waiting on a message that is not coming.
const detachRooms = function(server, sessionId) {
    const roomKeys = server.clients.get(sessionId)?.get("roomKeys");
    if (roomKeys === undefined) {
        return;
    }
    for (const roomKey of new Set(roomKeys)) {
        const room = server.rooms.get(roomKey);
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
    const held = heldRoom(server, ctx["sessionId"], message["roomKey"]);
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
        "roomKey": otherRoomKey(held["room"], held["isHost"]),
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
        "roomKey": string,      (this caller's own - see heldRoom)
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
        "roomKey": string
    }*/
    /*{
        "success": boolean
    }*/
    const server = ctx["server"];
    const held = heldRoom(server, ctx["sessionId"], ctx["message"]["roomKey"]);
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
        "roomKey": string,      (this caller's own - see heldRoom)
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
    let roomKey = "";
    for (let i = 1; i < FRAME_HEADER; i++) {
        roomKey += String.fromCharCode(header[i]);
    }

    // the same three questions the call above asks, in the same order
    if (isRelayAllowed(server, ctx["sessionId"]) === false) {
        return;
    }
    const held = heldRoom(server, ctx["sessionId"], roomKey);
    if (held === undefined) {
        return;
    }

    // and the far end's key over the sender's, in place: it knows the room by
    // that one and by no other, and it must not be handed this one
    const targetKey = otherRoomKey(held["room"], held["isHost"]);
    for (let i = 0; i < ROOM_KEY_LENGTH; i++) {
        header[1 + i] = targetKey.charCodeAt(i);
    }

    pushData(server, otherSessionId(held["room"], held["isHost"]), buffer);
};

// the types this group answers
const handlers = {
    "room-signal": roomSignal,
    "room-data": roomData,
    "room-leave": roomLeave
};

export { handlers, createRoom, closeRoom, detachRooms, releaseRooms, heldRoom, otherSessionId, otherRoomKey, isRelayAllowed, roomSignal, roomData, roomFrame, roomLeave, SIGNAL_MAX, DATA_MAX, FRAME_DATA, FRAME_JSON, FRAME_HEADER, ROOM_KEY_LENGTH };
export default handlers;
