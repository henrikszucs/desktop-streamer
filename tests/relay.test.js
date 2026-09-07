"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import Communicator from "../src/server/communicator.js";
import serverWS from "../src/server/ws/ws.js";
import { buildPublicConf } from "../src/server/ws/handlers/conf.js";
import { releasePairCodes } from "../src/server/ws/handlers/pairing.js";
import { releaseRooms, FRAME_HEADER, FRAME_DATA } from "../src/server/ws/handlers/rooms.js";

// This one runs the real thing: the real ServerWS, the real dispatch, the real
// handlers, and a real Communicator at each end - everything the two machines
// talk through except the TLS socket between them, which is replaced by a pair
// of functions handing bytes to each other.
//
// The relay is what it is here to prove. There is no TURN in this project: two
// devices that cannot reach each other talk *through the WebSocket server*, so
// what has to be true is that a message a peer sends comes out at the host and
// the other way round, over the same connection everything else uses.

// what the server thinks its configuration says
const buildConf = function(guestAllowRelay) {
    return {
        "ws": {
            "webrtc": {"iceServers": ["stun:stun.l.google.com:19302"]},
            "permissions": {
                "guestAllowShare": true,
                "guestAllowJoin": true,
                "guestAllowRelay": guestAllowRelay
            }
        }
    };
};

// a socket that is two function calls rather than a network. The server holds
// this object exactly as it holds a real one - send, the three listeners, the
// address the pairing push reports - and never learns the difference.
const buildSocket = function() {
    const listeners = new Map();
    const socket = {
        "_socket": {"remoteAddress": "127.0.0.1"},
        "onSend": function() {},
        "send": function(data) {
            socket.onSend(data);
        },
        "addEventListener": function(type, listener) {
            listeners.set(type, listener);
        },
        "terminate": function() {
            listeners.get("close")?.({});
        },
        "close": function() {
            listeners.get("close")?.({});
        },
        // what the client end of the wire hands in
        "deliver": function(data) {
            listeners.get("message")?.({"data": data});
        }
    };
    return socket;
};

// one machine: its own communicator, wired to the socket the server holds
const buildClient = async function() {
    const socket = buildSocket();
    const pushes = [];

    const com = new Communicator({
        "sender": async function(data) {
            if ((data instanceof ArrayBuffer) === false) {
                data = JSON.stringify(data);
            }
            socket.deliver(data);
        },
        "interactTimeout": 3000,
        "timeout": 5000,
        "packetSize": 1000,
        "packetTimeout": 1000,
        "packetRetry": Infinity,
        "sendThreads": 16
    });

    // what the server says on its own, kept the way the browser client keeps it
    com.onIncoming(async function(messageObj) {
        await messageObj.wait();
        pushes.push(messageObj.data);
    });

    socket.onSend = function(data) {
        if (typeof data === "string") {
            data = JSON.parse(data);
        }
        com.receive(data);
    };

    // Both ends sync, exactly as they do over a real socket: the server does it
    // from clientConnect and the browser client from its own "open" handler
    // (src/client/web/src/server.js). Which side owns which message ids is what
    // is being agreed, so one side doing it alone is not a connection.
    const connecting = serverWS.clientConnect(socket);
    await com.sideSync();
    await com.timeSync();
    await connecting;
    return {"socket": socket, "com": com, "pushes": pushes};
};

const call = async function(client, message) {
    const messageObj = client["com"].invoke(message);
    await messageObj.wait();
    assert.equal(messageObj.error, "", "the call did not get an answer: " + message["type"]);
    return messageObj.data;
};

const pushesOf = function(client, type) {
    return client["pushes"].filter(function(message) {
        return message?.["type"] === type;
    });
};

// the frames this end was handed, as the relay carried them
const framesOf = function(client) {
    return client["pushes"].filter(function(message) {
        return message instanceof ArrayBuffer;
    });
};

// the client half of the frame, written here rather than imported: a test that
// builds the bytes itself is what catches the two halves drifting apart
const buildFrame = function(roomId, payload) {
    const bytes = new Uint8Array(FRAME_HEADER + payload.byteLength);
    bytes[0] = FRAME_DATA;
    for (let i = 0; i < roomId.length; i++) {
        bytes[1 + i] = roomId.charCodeAt(i);
    }
    bytes.set(new Uint8Array(payload), FRAME_HEADER);
    return bytes.buffer;
};

// a payload with a shape, so what comes out can be checked against what went in
// rather than only counted
const buildPayload = function(size) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        bytes[i] = i % 251;         // a prime, so the pattern does not line up
    }
    return bytes.buffer;
};

const isSamePayload = function(buffer, size) {
    if (buffer.byteLength !== size) {
        return false;
    }
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < size; i++) {
        if (bytes[i] !== i % 251) {
            return false;
        }
    }
    return true;
};

// the pushes are sent without being waited for, so a moment is what stands
// between "the server sent it" and "this end has it"
const settle = async function() {
    for (let i = 0; i < 10; i++) {
        await new Promise(function(resolve) {
            setTimeout(resolve, 20);
        });
    }
};

// two machines that have just been paired, which is where every room comes from
const buildRoom = async function(guestAllowRelay = true) {
    serverWS.confPublic = buildPublicConf(buildConf(guestAllowRelay), "0.0.0");
    serverWS.db = null;
    serverWS.isClosing = false;

    const host = await buildClient();
    const peer = await buildClient();

    const created = await call(host, {"type": "pair-create"});
    const requested = await call(peer, {"type": "pair-request", "pairCode": created["pairCode"]});
    assert.equal(requested["success"], true);
    await settle();

    // remember is left off on purpose: a pairing that leaves no join behind is
    // the case that has nothing but the room to hold the two ends together
    const accepted = await call(host, {"type": "pair-accept", "remember": false, "unsupervised": false});
    assert.equal(accepted["success"], true);
    await settle();

    const hostOpen = pushesOf(host, "room-open")[0];
    const peerOpen = pushesOf(peer, "room-open")[0];
    return {"host": host, "peer": peer, "hostOpen": hostOpen, "peerOpen": peerOpen};
};

const dropRoom = function() {
    releaseRooms(serverWS);
    releasePairCodes(serverWS);
    serverWS.clients.clear();
    serverWS.joins.clear();
};

//
// the room the two ends are put in
//
test("an accepted pairing puts both machines in one room, each told its side", async () => {
    const {hostOpen, peerOpen} = await buildRoom();

    assert.equal(typeof hostOpen["roomId"], "string");
    assert.equal(hostOpen["roomId"], peerOpen["roomId"]);
    assert.equal(hostOpen["isHost"], true);
    assert.equal(peerOpen["isHost"], false);

    dropRoom();
});

//
// the relay itself
//
test("the peer reaches the host through the server, and the host reaches back", async () => {
    const {host, peer, peerOpen} = await buildRoom(true);
    const roomId = peerOpen["roomId"];

    // peer -> server -> host
    const up = await call(peer, {"type": "room-data", "roomId": roomId, "data": {"from": "peer", "n": 1}});
    assert.equal(up["success"], true);
    await settle();

    const atHost = pushesOf(host, "room-data");
    assert.equal(atHost.length, 1);
    assert.deepEqual(atHost[0]["data"], {"from": "peer", "n": 1});
    assert.equal(atHost[0]["roomId"], roomId);
    assert.equal(pushesOf(peer, "room-data").length, 0);

    // host -> server -> peer, the same relay the other way round
    const down = await call(host, {"type": "room-data", "roomId": roomId, "data": {"from": "host", "n": 2}});
    assert.equal(down["success"], true);
    await settle();

    const atPeer = pushesOf(peer, "room-data");
    assert.equal(atPeer.length, 1);
    assert.deepEqual(atPeer[0]["data"], {"from": "host", "n": 2});

    dropRoom();
});

test("the negotiation crosses the same way, so the relay is the fallback and not a second protocol", async () => {
    const {host, peer, peerOpen} = await buildRoom(true);

    await call(peer, {"type": "room-signal", "roomId": peerOpen["roomId"], "signal": {"kind": "description"}});
    await settle();
    assert.equal(pushesOf(host, "room-signal").length, 1);

    // and the client's way of saying it gave up on a direct connection
    await call(host, {"type": "room-signal", "roomId": peerOpen["roomId"], "signal": {"kind": "relay"}});
    await settle();
    assert.deepEqual(pushesOf(peer, "room-signal")[0]["signal"], {"kind": "relay"});

    dropRoom();
});

test("a server that does not carry data refuses it, and carries the negotiation anyway", async () => {
    const {host, peer, peerOpen} = await buildRoom(false);
    const roomId = peerOpen["roomId"];

    const refused = await call(peer, {"type": "room-data", "roomId": roomId, "data": {"from": "peer"}});
    assert.equal(refused["success"], false);
    assert.equal(refused["error"], "not-allowed");
    await settle();
    assert.equal(pushesOf(host, "room-data").length, 0);

    // the two ends can still try to reach each other directly: only the fallback
    // is what the configuration took away
    const signalled = await call(peer, {"type": "room-signal", "roomId": roomId, "signal": {"kind": "description"}});
    assert.equal(signalled["success"], true);

    dropRoom();
});

//
// the size the relay carries
//
// The communicator splits an ArrayBuffer into 1000 byte packets and puts it back
// together at the other end, which is why the binary frame exists at all: a JSON
// message is not split, so a message is for the small things and a frame is for
// everything else. These carry a payload with a shape in it and check every byte
// that comes out, because "it arrived" and "it arrived intact" are two claims.
test("the relay carries a message far bigger than any packet, byte for byte", async () => {
    const {host, peer, peerOpen} = await buildRoom(true);
    const size = 512 * 1024;        // 512 KB, some five hundred packets

    peer["com"].send(buildFrame(peerOpen["roomId"], buildPayload(size)), [], 60000);
    for (let i = 0; i < 100 && framesOf(host).length === 0; i++) {
        await settle();
    }

    const frames = framesOf(host);
    assert.equal(frames.length, 1);

    // the header the other end reads is the one this end wrote
    const header = new Uint8Array(frames[0], 0, FRAME_HEADER);
    assert.equal(header[0], FRAME_DATA);
    assert.equal(String.fromCharCode(...header.subarray(1)), peerOpen["roomId"]);
    assert.equal(isSamePayload(frames[0].slice(FRAME_HEADER), size), true);
    assert.equal(framesOf(peer).length, 0);

    dropRoom();
});

test("a frame is refused on the same three grounds a message is", async () => {
    const {host, peer, peerOpen} = await buildRoom(false);

    // no permission: the frame is dropped and nothing is answered back, because
    // there is no answer on a one way frame to wait for
    peer["com"].send(buildFrame(peerOpen["roomId"], buildPayload(64)), [], 5000);
    await settle();
    assert.equal(framesOf(host).length, 0);

    dropRoom();

    // a room this socket is not in
    const room = await buildRoom(true);
    room["peer"]["com"].send(buildFrame("XXXXXXXXXX", buildPayload(64)), [], 5000);
    await settle();
    assert.equal(framesOf(room["host"]).length, 0);

    // and a frame with nothing behind its header
    room["peer"]["com"].send(new Uint8Array(FRAME_HEADER).buffer, [], 5000);
    await settle();
    assert.equal(framesOf(room["host"]).length, 0);

    dropRoom();
});

test("what a connection may relay is answered when it is taken, not when it asks", async () => {
    const {host, peer, peerOpen} = await buildRoom(false);

    // The configuration is changed under the running server, which is the thing
    // this project does not do: a relay permission is read at boot, cached on
    // every connection, and never re-read from a row while one is live. The
    // point of the test is that this changes nothing for the sockets that are
    // already here.
    serverWS.confPublic = buildPublicConf(buildConf(true), "0.0.0");

    const refused = await call(peer, {"type": "room-data", "roomId": peerOpen["roomId"], "data": {"from": "peer"}});
    assert.equal(refused["error"], "not-allowed");
    await settle();
    assert.equal(pushesOf(host, "room-data").length, 0);

    dropRoom();
});

//
// what ends it
//
test("a machine that goes takes the room with it and the other one is told", async () => {
    const {host, peer} = await buildRoom(true);

    peer["socket"].close();
    await settle();

    const closed = pushesOf(host, "room-close");
    assert.equal(closed.length, 1);
    assert.equal(closed[0]["reason"], "gone");
    assert.equal(serverWS.rooms.size, 0);

    dropRoom();
});

test("a room that is over carries nothing more", async () => {
    const {host, peer, peerOpen} = await buildRoom(true);
    const roomId = peerOpen["roomId"];

    await call(peer, {"type": "room-leave", "roomId": roomId});
    await settle();
    assert.equal(pushesOf(host, "room-close").length, 1);

    const after = await call(peer, {"type": "room-data", "roomId": roomId, "data": {"late": true}});
    assert.equal(after["error"], "unknown-room");
    assert.equal(pushesOf(host, "room-data").length, 0);

    dropRoom();
});
