"use strict";

// the live connection between this device and the other one: the room the server
// put the two sockets in, and the WebRTC connection negotiated across it.
//
// It stands either direct or relayed through the server, speaks the same
// protocol both ways, carries no media yet, and is opened by the server's
// room-open rather than by hand. Why each of those is so - and what the two
// holding places below are for - is .claude/CLIENT.md, "The connection".

// third-party dependencies
import Communicator from "../libs/communicator/communicator.js";

// how the two ends are told apart: the peer asked for the connection, so the
// peer is the one that opens it and the host answers. It is one rule rather than
// a negotiation about who negotiates.
const isOfferer = function(isHost) {
    return isHost !== true;
};

// what the channel is called. Nothing is sent on it yet - it is the handshake
// that proves the path, and the seam the control protocol lands on.
const CHANNEL_NAME = "control";

// how long the direct connection is given before the fallback is taken. ICE has
// tried everything it has by then on any path that works, and what is left is a
// wait nobody can end - so it is the relay or nothing, and the relay is worth
// nothing later than this.
const DIRECT_TIMEOUT = 12000;

// the two ways a room can stand, and the one the room screen draws
const MODE_DIRECT = "direct";
const MODE_RELAY = "relay";

// what one SCTP message carries: the size every browser agrees on, against the
// socket's 1 KB - no proxy sits in the middle of this leg
const CHANNEL_PACKET_SIZE = 16000;

// what one message is given to cross, whole rather than packet by packet: a
// frame worth megabytes is a lot of packets and none of them is late
const DATA_TIMEOUT = 60000;

// how long a lost direct connection is given to turn out to be the other end
// having left, which arrives on the socket rather than on the channel
const CLOSE_GRACE = 1000;

const createRoom = function(ctx) {
    // events: connecting, connected, closed
    const events = new EventTarget();

    let connection = null;      // RTCPeerConnection
    let channel = null;         // RTCDataChannel
    let channelCom = null;      // the Communicator over that channel
    let roomId = "";
    let joinId = "";            // the join this room is on, "" for a pairing nobody remembered
    let name = "";              // what this side calls it while it stands - see setName
    let isHost = false;
    let state = "closed";       // closed | connecting | connected
    let mode = MODE_DIRECT;     // direct | relay - what is carrying it
    let directTimeoutId = -1;

    // a candidate that arrives before the description it belongs to has nowhere
    // to go yet: ICE starts on both ends at once and the two messages cross
    const earlyCandidates = [];

    // and a signal that arrives before this side's own room-open, kept by room
    // id because that is all this side knows about it until one comes
    const earlySignals = new Map();     // roomId -> [signal]

    // enough for an offer and the candidates that chase it, and no more: what is
    // held here is held for a room this side may never be in
    const EARLY_MAX = 64;

    const holdSignal = function(detail) {
        const earlyRoomId = detail?.["roomId"];
        if (typeof earlyRoomId !== "string" || earlyRoomId === "") {
            return;
        }
        const held = earlySignals.get(earlyRoomId) ?? [];
        if (held.length >= EARLY_MAX) {
            return;
        }
        held.push(detail["signal"]);
        earlySignals.set(earlyRoomId, held);
    };

    const emit = function(type, detail) {
        events.dispatchEvent(new CustomEvent(type, {"detail": detail}));
    };

    // the ICE servers of the server that introduced the two ends, as the browser
    // wants them: the configuration carries the URLs alone
    const iceServers = function() {
        const urls = ctx["conf"]["remote"]?.["webrtc"]?.["iceServers"] ?? [];
        return urls.map(function(url) {
            return {"urls": url};
        });
    };

    // one message to the other end. A signal that does not arrive is the
    // negotiation failing, and the connection state is what says so - there is
    // nothing to retry here that ICE does not retry itself.
    const send = async function(signal) {
        if (roomId === "") {
            return false;
        }
        try {
            await ctx["server"].roomSignal(roomId, signal);
            return true;
        } catch (error) {
            console.error("Cannot send a signal:", error);
            return false;
        }
    };

    // the local end goes first, then the other one hears about it. A description
    // that does not reach the other side is the whole negotiation: there is
    // nothing after it to recover with, so it ends the attempt rather than
    // leaving a wait that nothing will ever end.
    const describe = async function(description) {
        await connection.setLocalDescription(description);
        const isSent = await send({
            "kind": "description",
            "description": {
                "type": connection.localDescription.type,
                "sdp": connection.localDescription.sdp
            }
        });
        console.log("Room " + roomId + " sent " + connection.localDescription.type + (isSent === true ? "" : " (failed)"));
        if (isSent === false) {
            leave("failed");
        }
    };

    const negotiate = async function() {
        try {
            await describe(await connection.createOffer());
        } catch (error) {
            console.error("Cannot make the offer:", error);
            leave("failed");
        }
    };

    // The channel is the handshake and the sync over it is the proof. The
    // communicator is built here rather than on "open" because the other end may
    // sync into this one before that fires - see CLIENT.md, "The connection".
    const wireChannel = function() {
        channel.binaryType = "arraybuffer";

        channelCom = new Communicator({
            "sender": async function(data) {
                if ((data instanceof ArrayBuffer) === false) {
                    data = JSON.stringify(data);
                }
                channel.send(data);
            },
            "interactTimeout": 3000,
            "timeout": 5000,
            "packetSize": CHANNEL_PACKET_SIZE,
            "packetTimeout": 1000,
            "packetRetry": Infinity,
            "sendThreads": 16
        });

        // whatever the other end says, in the words it was said in: an object
        // comes back an object and bytes come back bytes, the same as the relay
        channelCom.onIncoming(async function(messageObj) {
            await messageObj.wait();
            if (messageObj.error !== "") {
                return;
            }
            emit("message", {"roomId": roomId, "data": messageObj.data});
        });

        channel.addEventListener("message", function(event) {
            let data = event.data;
            if (typeof data === "string") {
                data = JSON.parse(data);
            }
            channelCom?.receive(data);
        });

        channel.addEventListener("open", async function() {
            const openRoomId = roomId;

            // both ends sync, as they do over the socket: which side owns which
            // message ids is what is being agreed, and one side doing it alone
            // is not a connection
            try {
                await channelCom.sideSync();
                await channelCom.timeSync();
            } catch (error) {
                // an open channel the two ends cannot sync over is not a
                // connection: the clock above is what takes it to the relay,
                // and saying "connected" here would stop that from happening
                console.error("Cannot sync the channel:", error);
                return;
            }
            if (roomId !== openRoomId || mode !== MODE_DIRECT) {
                return;         // the room went, or the relay was taken meanwhile
            }

            clearTimeout(directTimeoutId);
            directTimeoutId = -1;
            state = "connected";
            emit("connected", {"roomId": roomId, "isHost": isHost, "isRelay": false});
        });

        // a channel that closes while it *is* the room is the connection being
        // lost, which the relay is for as much as one that never came up
        channel.addEventListener("close", function() {
            if (mode !== MODE_DIRECT) {
                return;
            }
            setTimeout(function() {
                if (roomId === "" || mode !== MODE_DIRECT || state === "closed") {
                    return;     // the socket has since said what happened
                }
                console.log("Room " + roomId + " lost its direct connection");
                startRelay(false);
            }, CLOSE_GRACE);
        });
    };

    //
    // the fallback
    //
    // whether there is one at all. It is answered for every client, so this
    // holds no default of its own, and one that is not there is not waited for.
    const isRelayAllowed = function() {
        return ctx["conf"]["remote"]?.["permissions"]?.["guestAllowRelay"] === true;
    };

    // Both ends have to give up together and they will not give up at the same
    // moment: whoever gets there first says so, and the other follows on the
    // spot rather than waiting out its own clock.
    const startRelay = function(isTold) {
        if (mode === MODE_RELAY || roomId === "") {
            return;
        }
        if (isRelayAllowed() === false) {
            if (isTold !== true) {
                console.log("Room " + roomId + " has no relay to fall back on");
                teardown("failed");
            }
            return;
        }

        clearTimeout(directTimeoutId);
        directTimeoutId = -1;
        mode = MODE_RELAY;

        // what is left of the direct attempt is a connection nobody is
        // negotiating, and a channel whose death would be reported as the room's
        closeConnection();

        if (isTold !== true) {
            send({"kind": "relay"});
        }
        state = "connected";
        console.log("Room " + roomId + " is connected through the server");
        emit("connected", {"roomId": roomId, "isHost": isHost, "isRelay": true});
    };

    // the direct attempt, given a clock of its own. ICE reports "failed" where it
    // can, but a connection that never gathers anything usable reports nothing at
    // all - and a wait with nothing behind it is what this fallback exists to end.
    const startDirectClock = function() {
        clearTimeout(directTimeoutId);
        directTimeoutId = setTimeout(function() {
            if (state === "connected" || roomId === "") {
                return;
            }
            console.log("Room " + roomId + " could not connect directly");
            startRelay(false);
        }, DIRECT_TIMEOUT);
    };

    const open = function(detail) {
        // one room at a time on this client. The server does not impose that -
        // a host may be in several - but one screen shows one connection, so a
        // second is what the first is replaced by rather than hidden behind.
        if (roomId !== "") {
            leave("replaced");
        }

        roomId = detail?.["roomId"] ?? "";
        joinId = detail?.["joinId"] ?? "";
        name = "";
        isHost = (detail?.["isHost"] === true);
        mode = MODE_DIRECT;
        if (roomId === "") {
            return;
        }
        startDirectClock();

        connection = new RTCPeerConnection({"iceServers": iceServers()});
        connection.addEventListener("icecandidate", function(event) {
            // the null candidate is the end of the gathering, and says nothing
            // the other end needs
            if (event.candidate === null) {
                return;
            }
            send({"kind": "candidate", "candidate": event.candidate.toJSON()});
        });
        connection.addEventListener("connectionstatechange", function() {
            // "disconnected" is not an ending - ICE is allowed to come back from
            // it - so only the two that are wait for nothing
            const current = connection?.connectionState;
            console.log("Room " + roomId + " is " + current);

            // a direct connection that failed is what the relay is for; one that
            // was closed on purpose is not
            if (current === "failed") {
                startRelay(false);
                return;
            }
            if (current === "closed" && mode === MODE_DIRECT) {
                teardown(current);
            }
        });

        if (isOfferer(isHost) === true) {
            channel = connection.createDataChannel(CHANNEL_NAME);
            wireChannel();
            negotiate();
        } else {
            connection.addEventListener("datachannel", function(event) {
                channel = event.channel;
                wireChannel();
            });
        }

        state = "connecting";
        emit("connecting", {"roomId": roomId, "isHost": isHost});
        console.log("Room " + roomId + " open as " + (isHost === true ? "host" : "peer"));

        // whatever arrived before this side knew there was a room. Every other
        // room id held here belongs to one this client is not in.
        const held = earlySignals.get(roomId) ?? [];
        earlySignals.clear();
        for (const signal of held) {
            onSignal({"roomId": roomId, "signal": signal});
        }
    };

    const onSignal = async function(detail) {
        if (connection === null || detail?.["roomId"] !== roomId) {
            holdSignal(detail);
            return;
        }
        const signal = detail["signal"] ?? {};
        try {
            if (signal["kind"] === "description") {
                await connection.setRemoteDescription(signal["description"]);

                // whatever crossed the description on the way here belongs to it
                while (earlyCandidates.length > 0) {
                    await connection.addIceCandidate(earlyCandidates.shift());
                }
                if (signal["description"]?.["type"] === "offer") {
                    await describe(await connection.createAnswer());
                }
                return;
            }
            // the other end could not get through either, and is on the relay
            if (signal["kind"] === "relay") {
                startRelay(true);
                return;
            }
            if (signal["kind"] === "candidate") {
                if (connection.remoteDescription === null) {
                    earlyCandidates.push(signal["candidate"]);
                    return;
                }
                await connection.addIceCandidate(signal["candidate"]);
            }
        } catch (error) {
            console.error("Cannot handle a signal:", error);
        }
    };

    // the direct attempt alone: the room stands, and on the relay it stands
    // without any of this
    const closeConnection = function() {
        try {
            // the communicator holds clocks of its own, so it is let go before
            // the channel it was speaking over
            channelCom?.release?.();
            channel?.close?.();
            connection?.close?.();
        } catch (error) {
            console.error("Cannot close the connection:", error);
        }
        channelCom = null;
        channel = null;
        connection = null;
        earlyCandidates.length = 0;
    };

    // everything this client holds of the connection, and nothing about the
    // server's half of it - which is why the two ways out below are different
    const teardown = function(reason) {
        const closedRoomId = roomId;
        roomId = "";
        joinId = "";
        name = "";
        mode = MODE_DIRECT;
        clearTimeout(directTimeoutId);
        directTimeoutId = -1;

        closeConnection();
        earlySignals.clear();

        if (state === "closed") {
            return "";
        }
        state = "closed";
        console.log("Room " + closedRoomId + " closed (" + reason + ")");
        emit("closed", {"roomId": closedRoomId, "reason": reason});
        return closedRoomId;
    };

    // this side is done with it, so the other one is told through the server -
    // the room goes with it and nothing is left holding a socket open
    const leave = function(reason = "left") {
        const closedRoomId = teardown(reason);
        if (closedRoomId !== "") {
            ctx["server"].roomLeave(closedRoomId);
        }
    };

    //
    // what the server says about it
    //
    ctx["server"].addEventListener("room-open", function(event) {
        open(event.detail);
    });
    ctx["server"].addEventListener("room-signal", function(event) {
        onSignal(event.detail);
    });

    // what the other end said, carried by the server because the two of them
    // could not say it to each other
    ctx["server"].addEventListener("room-data", function(event) {
        if (event.detail?.["roomId"] !== roomId) {
            return;
        }

        // the first relayed message is also the other end saying it gave up, for
        // the case where the signal that says so is the one that went missing
        startRelay(true);
        emit("message", {"roomId": roomId, "data": event.detail?.["data"]});
    });

    // the other end left, or its socket did: the room is already gone on the
    // server, so this one only takes itself down
    ctx["server"].addEventListener("room-close", function(event) {
        if (event.detail?.["roomId"] !== roomId) {
            return;
        }
        teardown(event.detail?.["reason"] ?? "closed");
    });

    return {
        "addEventListener": events.addEventListener.bind(events),
        "removeEventListener": events.removeEventListener.bind(events),

        "leave": leave,

        // one way out for whatever the two ends have to say, whichever of the two
        // is carrying it. Nothing sends anything yet - the stream and the control
        // protocol are what will - and a relayed message is a call the server
        // answers, so this one reports rather than throws.
        "send": async function(data) {
            if (state !== "connected") {
                return false;
            }
            if (mode === MODE_RELAY) {
                // everything goes as a frame, bytes or not: the communicator
                // splits those into packets, so this is the one path with no
                // size to stay under and there is no reason to keep a second
                if (roomId === "") {
                    return false;
                }
                return await ctx["server"].roomDataSend(roomId, data);
            }
            // the direct leg is the same protocol as the relay: the communicator
            // splits it, acknowledges it and puts it together at the other end,
            // so nothing here has a size to stay under either
            if (channelCom === null) {
                return false;
            }
            try {
                const messageObj = channelCom.send(data, [], DATA_TIMEOUT);
                await messageObj.wait();
                return messageObj.error === "";
            } catch (error) {
                console.error("Cannot send a message:", error);
                return false;
            }
        },

        "getState": function() {
            return state;
        },
        "getMode": function() {
            return mode;
        },
        "isRelay": function() {
            return mode === MODE_RELAY;
        },
        "isConnected": function() {
            return state === "connected";
        },
        "getRoomId": function() {
            return roomId;
        },

        // the join this room stands on, when it stands on one. A pairing the
        // host did not remember has none: the room is the whole of it, and it
        // dies with either socket.
        "getJoinId": function() {
            return joinId;
        },
        "isHost": function() {
            return isHost;
        },

        // what this side calls the connection it is in. A room that stands on no
        // join has nowhere to put a name - the row that would keep one is the
        // thing it does not have - so this is a name for as long as the
        // connection is, and it goes when the connection does. A room that *is*
        // on a join is named on the row instead (join-rename), which is the name
        // the other device is handed back the next time it presents its code.
        "getName": function() {
            return name;
        },
        "setName": function(value) {
            name = (typeof value === "string" ? value : "");
            emit("name", {"roomId": roomId, "name": name});
        },

        // whether this client is sharing itself out right now. It is the room
        // and not the record that answers: a pairing nobody remembered leaves
        // no record to ask, and it is a share for as long as it stands - which
        // is what the shares screen and the badge of the two bars draw.
        "isSharing": function() {
            return isHost === true && state !== "closed";
        },

        // the two objects the media work will hang off, rather than building a
        // second connection beside this one
        "getConnection": function() {
            return connection;
        },
        "getChannel": function() {
            return channel;
        },

        // the protocol over whichever leg is carrying the room: the channel's
        // own communicator here, and ctx["server"]'s for a relayed room
        "getCommunicator": function() {
            return channelCom;
        }
    };
};

export { createRoom, isOfferer, CHANNEL_NAME, DIRECT_TIMEOUT, CLOSE_GRACE };
export default { createRoom, isOfferer, CHANNEL_NAME, DIRECT_TIMEOUT, CLOSE_GRACE };
