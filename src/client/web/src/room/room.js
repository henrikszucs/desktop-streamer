"use strict";

// the live connection between this device and the other one: the room the server
// put the two sockets in, and the WebRTC connection negotiated across it.
//
// It stands either direct or relayed through the server, speaks the same
// protocol both ways, carries the stream on a channel of its own, and is opened by the server's
// room-open rather than by hand. Why each of those is so - and what the two
// holding places below are for - is .claude/CLIENT.md, "The connection".

// third-party dependencies
import Communicator from "../../libs/communicator/communicator.js";

// first-party dependencies
import { createKeys, deriveSeal } from "./seal.js";

// how the two ends are told apart: the peer asked for the connection, so the
// peer is the one that opens it and the host answers. It is one rule rather than
// a negotiation about who negotiates.
const isOfferer = function(isHost) {
    return isHost !== true;
};

// what the two channels are called. The first is the handshake that proves the
// path and the one the control protocol and the settings go over - ordered,
// reliable, answered. The second carries the stream and nothing else: unordered
// and unreliable, because a frame that is late is worth less than the next one
// (see .claude/CLIENT.md, "The stream").
const CHANNEL_NAME = "control";
const VIDEO_CHANNEL_NAME = "video";

// how much the video channel may hold before a frame is refused rather than
// queued: two frames of a generous size. What is above it is latency, not
// throughput - the line is not taking it and the picture is falling behind.
const VIDEO_BACKLOG = 512 * 1024;

// the same line on the relay, drawn at the socket: a relayed frame goes whole
// rather than in SCTP-sized pieces, so it is given room for a keyframe and one
// more, and past it a frame is refused exactly as on the direct leg
const RELAY_BACKLOG = 1024 * 1024;

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

// how long a room on the relay waits for the keys that seal it. They cross at
// room-open, long before any fallback, so a room still without them by then
// has lost a signal and would otherwise wait on nothing.
const SEAL_TIMEOUT = 5000;

const createRoom = function(ctx) {
    // events: connecting, connected, closed
    const events = new EventTarget();

    let connection = null;      // RTCPeerConnection
    let channel = null;         // RTCDataChannel - control
    let channelCom = null;      // the Communicator over that channel
    let videoChannel = null;    // RTCDataChannel - the stream, raw
    let roomKey = "";           // this side's own key for the room - never the other side's
    let joinId = "";            // the join this room is on, "" for a pairing nobody remembered
    let name = "";              // what this side calls it while it stands - see setName
    let isHost = false;
    let state = "closed";       // closed | connecting | connected
    let mode = MODE_DIRECT;     // direct | relay - what is carrying it
    let directTimeoutId = -1;
    let attempt = 0;            // which direct attempt the channels belong to: a
                                // retry from the relay is a second one

    // the relay's end-to-end layer (src/room/seal.js): this side's key pair, the
    // other end's public key, and the seal made of the two. Nothing crosses the
    // relay without it, so a room on the relay is not "connected" until it is in.
    let keys = null;
    let otherKey = "";
    let seal = null;
    let isRelayPending = false;
    let sealTimeoutId = -1;
    let outbound = Promise.resolve();   // sealed payloads handed to the socket in order
    let inbound = Promise.resolve();    // and opened ones handed up in the order they came
    let sealingBytes = 0;               // frames still being sealed, for the backlog
    const earlyRelay = [];              // relayed payloads that came before the seal

    // a candidate that arrives before the description it belongs to has nowhere
    // to go yet: ICE starts on both ends at once and the two messages cross
    const earlyCandidates = [];

    // and a signal that arrives before this side's own room-open, kept by the
    // room key in it because that is all this side knows about it until one comes
    const earlySignals = new Map();     // roomKey -> [signal]

    // enough for an offer and the candidates that chase it, and no more: what is
    // held here is held for a room this side may never be in
    const EARLY_MAX = 64;

    const holdSignal = function(detail) {
        const earlyRoomKey = detail?.["roomKey"];
        if (typeof earlyRoomKey !== "string" || earlyRoomKey === "") {
            return;
        }
        const held = earlySignals.get(earlyRoomKey) ?? [];
        if (held.length >= EARLY_MAX) {
            return;
        }
        held.push(detail["signal"]);
        earlySignals.set(earlyRoomKey, held);
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
        if (roomKey === "") {
            return false;
        }
        try {
            await ctx["server"].roomSignal(roomKey, signal);
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
        console.log("Room " + roomKey + " sent " + connection.localDescription.type + (isSent === true ? "" : " (failed)"));
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
        const ownAttempt = attempt;
        channel.binaryType = "arraybuffer";

        channelCom = new Communicator({
            "sender": async function(data) {
                if ((data instanceof ArrayBuffer) === false) {
                    data = JSON.stringify(data);
                }
                channel.send(data);
            },
            "interactTimeout": 1500,
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
            emit("message", {"roomKey": roomKey, "data": messageObj.data});
        });

        channel.addEventListener("message", function(event) {
            let data = event.data;
            if (typeof data === "string") {
                data = JSON.parse(data);
            }
            channelCom?.receive(data);
        });

        channel.addEventListener("open", async function() {
            const openRoomKey = roomKey;

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
            if (roomKey !== openRoomKey || ownAttempt !== attempt) {
                return;         // the room went, or this attempt was given up meanwhile
            }

            // a retry that made it takes the room off the relay here, on the
            // proof, and the other end does the same on its own sync
            clearTimeout(directTimeoutId);
            directTimeoutId = -1;
            clearTimeout(sealTimeoutId);
            sealTimeoutId = -1;
            isRelayPending = false;
            mode = MODE_DIRECT;
            state = "connected";
            emit("connected", {"roomKey": roomKey, "isHost": isHost, "isRelay": false});
        });

        // a channel that closes while it *is* the room is the connection being
        // lost, which the relay is for as much as one that never came up
        channel.addEventListener("close", function() {
            if (mode !== MODE_DIRECT || ownAttempt !== attempt) {
                return;
            }
            setTimeout(function() {
                if (roomKey === "" || mode !== MODE_DIRECT || state === "closed") {
                    return;     // the socket has since said what happened
                }
                console.log("Room " + roomKey + " lost its direct connection");
                startRelay(false);
            }, CLOSE_GRACE);
        });
    };

    // The stream's channel is bytes in and bytes out and nothing on top: no
    // communicator, no acknowledgment, no reassembly - the frame format in
    // frame.js does the one part of that a picture needs. A chunk that arrives
    // is handed up as it is; one that does not is nobody's business here.
    const wireVideoChannel = function() {
        videoChannel.binaryType = "arraybuffer";
        videoChannel.bufferedAmountLowThreshold = VIDEO_BACKLOG / 2;
        videoChannel.addEventListener("message", function(event) {
            if (mode !== MODE_DIRECT || (event.data instanceof ArrayBuffer) === false) {
                return;
            }
            emit("frame", {"roomKey": roomKey, "data": event.data});
        });
    };

    //
    // the fallback
    //
    // whether there is one at all, for whoever this client is: the guest flag
    // of the conf-get answer, or the account's own (src/management/account.js).
    // Both are answered rather than defaulted, so one that is not there is not
    // waited for - and the bar greys its indicator on the same answer.
    const isRelayAllowed = function() {
        const account = ctx["account"]?.current?.() ?? null;
        if (account !== null) {
            return account["isRelayAllowed"] === true;
        }
        return ctx["conf"]["remote"]?.["permissions"]?.["guestAllowRelay"] === true;
    };

    // Both ends have to give up together and they will not give up at the same
    // moment: whoever gets there first says so, and the other follows on the
    // spot rather than waiting out its own clock. The same move is made by
    // hand from the room bar (useRelay), which is a peer on a direct path that
    // keeps dropping choosing the slower path that does not.
    const startRelay = function(isTold) {
        if (mode === MODE_RELAY || roomKey === "") {
            return;
        }
        // A side with no relay leaves the room rather than only letting go of
        // its own half: the other end may well have one, and it would sit on
        // the relay "connected" - a host capturing and sending its screen -
        // to a side that is no longer listening. Told or not, the room is over.
        if (isRelayAllowed() === false) {
            console.log("Room " + roomKey + " has no relay to fall back on");
            leave("failed");
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
        isRelayPending = true;
        if (seal === null) {
            console.log("Room " + roomKey + " is waiting for the keys to seal the relay");
            clearTimeout(sealTimeoutId);
            sealTimeoutId = setTimeout(function() {
                if (isRelayPending === true && seal === null && roomKey !== "") {
                    console.log("Room " + roomKey + " has no keys to seal the relay with");
                    leave("failed");
                }
            }, SEAL_TIMEOUT);
        }
        finishRelay();
    };

    // the relay is a connection once it is sealed, and not before: an unsealed
    // relay is the one thing this room will not fall back on
    const finishRelay = function() {
        if (isRelayPending === false || mode !== MODE_RELAY || seal === null || roomKey === "") {
            return;
        }
        isRelayPending = false;
        clearTimeout(sealTimeoutId);
        sealTimeoutId = -1;
        state = "connected";
        console.log("Room " + roomKey + " is connected through the server");
        emit("connected", {"roomKey": roomKey, "isHost": isHost, "isRelay": true});
    };

    //
    // the seal
    //
    // this side's key pair, made at room-open and its public half sent at once,
    // so both halves have crossed long before any fallback is taken
    const startKeys = async function() {
        const ownRoomKey = roomKey;
        try {
            const made = await createKeys();
            if (roomKey !== ownRoomKey) {
                return;
            }
            keys = made;
            await send({"kind": "key", "key": keys["publicKey"]});
            await startSeal();
        } catch (error) {
            console.error("Cannot make the keys for the relay:", error);
        }
    };

    // both halves in: the seal, then whatever came in on the relay before it
    const startSeal = async function() {
        if (keys === null || otherKey === "" || seal !== null) {
            return;
        }
        const ownRoomKey = roomKey;
        let made = null;
        try {
            made = await deriveSeal(keys, otherKey, isHost);
        } catch (error) {
            console.error("Cannot seal the relay:", error);
            return;
        }
        if (roomKey !== ownRoomKey || seal !== null) {
            return;
        }
        seal = made;
        for (const data of earlyRelay.splice(0)) {
            openRelayed(data);
        }
        finishRelay();
    };

    // one payload out over the relay, sealed. Sealing is async, so the payloads
    // are handed to the socket in a chain - in the order they were given, as
    // they went before - while the encryption itself runs at once. What is
    // reported is what roomDataSend reports: that the frame left.
    const relay = function(data) {
        const ownSeal = seal;
        const ownRoomKey = roomKey;
        const size = (data instanceof ArrayBuffer ? data.byteLength : 0);
        sealingBytes += size;

        // sealed here rather than inside the chain: the bytes are copied before
        // this returns, so the caller may reuse its buffer
        const sealing = ownSeal.seal(data);
        const handed = outbound.then(function() {
            return sealing;
        }).then(function(sealed) {
            if (seal !== ownSeal) {
                return {"sent": Promise.resolve(false)};
            }
            return {"sent": ctx["server"].roomDataSend(ownRoomKey, sealed)};
        }).finally(function() {
            if (seal === ownSeal) {
                sealingBytes -= size;
            }
        });
        outbound = handed.catch(function() {});
        return handed.then(function(result) {
            return result["sent"];
        });
    };

    // one payload in, opened, and handed up in the order it arrived. What does
    // not open - made, changed, replayed or turned round by the server - is
    // dropped, and never taken as the other end giving up.
    const openRelayed = function(data) {
        const ownSeal = seal;
        const opening = ownSeal.open(data);
        inbound = inbound.then(function() {
            return opening;
        }).then(function(opened) {
            if (seal !== ownSeal) {
                return;
            }
            if (typeof opened === "undefined") {
                console.warn("Room " + roomKey + " dropped a relayed message that did not open");
                return;
            }

            // the first relayed message is also the other end saying it gave up -
            // while this side is still waiting on its direct attempt, see CLIENT.md
            if (mode === MODE_DIRECT && state !== "connected") {
                startRelay(true);
            }

            // bytes are the stream and an object is a message, on this leg as on
            // the direct one - so what listens for either never asks which leg
            const payload = opened["data"];
            emit((payload instanceof ArrayBuffer ? "frame" : "message"), {"roomKey": roomKey, "data": payload});
        }).catch(function(error) {
            console.error("Cannot open a relayed message:", error);
        });
    };

    // everything the seal holds, for a room that is over
    const dropSeal = function() {
        keys = null;
        otherKey = "";
        seal = null;
        isRelayPending = false;
        clearTimeout(sealTimeoutId);
        sealTimeoutId = -1;
        outbound = Promise.resolve();
        inbound = Promise.resolve();
        sealingBytes = 0;
        earlyRelay.length = 0;
    };

    // the direct attempt, given a clock of its own. ICE reports "failed" where it
    // can, but a connection that never gathers anything usable reports nothing at
    // all - and a wait with nothing behind it is what this fallback exists to end.
    const startDirectClock = function() {
        clearTimeout(directTimeoutId);
        directTimeoutId = setTimeout(function() {
            if (roomKey === "") {
                return;
            }
            if (mode === MODE_RELAY) {
                giveUpDirect();     // a retry that ran out: the relay stands
                return;
            }
            if (state === "connected") {
                return;
            }
            console.log("Room " + roomKey + " could not connect directly");
            startRelay(false);
        }, DIRECT_TIMEOUT);
    };

    // a retry from the relay that did not make it, or was told to stop: the
    // attempt goes and the room stays where it was
    const giveUpDirect = function() {
        if (connection === null) {
            return;
        }
        console.log("Room " + roomKey + " could not connect directly again");
        closeConnection();
        emit("direct", {"roomKey": roomKey, "isTrying": false});
    };

    // the direct attempt itself: one RTCPeerConnection, the two channels on it,
    // and the offer from whichever side offers. The first attempt is made by
    // open(), a retry by startDirect().
    const createConnection = function() {
        attempt++;
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
            console.log("Room " + roomKey + " is " + current);

            // a direct connection that failed is what the relay is for; a retry
            // that failed leaves the relay standing; one that was closed on
            // purpose is neither
            if (current === "failed") {
                if (mode === MODE_RELAY) {
                    giveUpDirect();
                } else {
                    startRelay(false);
                }
                return;
            }
            if (current === "closed" && mode === MODE_DIRECT) {
                teardown(current);
            }
        });

        if (isOfferer(isHost) === true) {
            channel = connection.createDataChannel(CHANNEL_NAME);
            wireChannel();
            // the stream's channel is opened beside it, by the same side, so
            // both are in the one offer and neither end negotiates twice
            videoChannel = connection.createDataChannel(VIDEO_CHANNEL_NAME, {
                "ordered": false,
                "maxRetransmits": 0
            });
            wireVideoChannel();
            negotiate();
        } else {
            connection.addEventListener("datachannel", function(event) {
                if (event.channel.label === VIDEO_CHANNEL_NAME) {
                    videoChannel = event.channel;
                    wireVideoChannel();
                    return;
                }
                channel = event.channel;
                wireChannel();
            });
        }
    };

    // whatever arrived before this side had a connection to hand it to. Every
    // other room id held here belongs to one this client is not in.
    const replayHeldSignals = function() {
        const held = earlySignals.get(roomKey) ?? [];
        earlySignals.clear();
        for (const signal of held) {
            onSignal({"roomKey": roomKey, "signal": signal});
        }
    };

    // a direct connection tried again from the relay, at either end's asking
    // (useDirect from the room bar, or the other end's `direct` signal). The
    // relay carries the room throughout: nothing moves until the new channel
    // is synced, so a retry that fails costs a wait and not a picture.
    const startDirect = async function(isTold) {
        if (roomKey === "" || mode !== MODE_RELAY || connection !== null) {
            return;     // no room, nothing to come back from, or a retry already running
        }
        if (isTold !== true && await send({"kind": "direct"}) === false) {
            return;
        }
        if (roomKey === "" || mode !== MODE_RELAY || connection !== null) {
            return;     // the wait on the signal changed one of the three
        }
        console.log("Room " + roomKey + " is trying a direct connection again");
        emit("direct", {"roomKey": roomKey, "isTrying": true});

        // what is held is the tail of the attempt that failed, not the start of
        // this one: the `direct` signal goes ahead of the offer on both ends
        earlySignals.clear();
        createConnection();
        startDirectClock();
    };

    const open = function(detail) {
        // one room at a time on this client. The server does not impose that -
        // a host may be in several - but one screen shows one connection, so a
        // second is what the first is replaced by rather than hidden behind.
        if (roomKey !== "") {
            leave("replaced");
        }

        roomKey = detail?.["roomKey"] ?? "";
        joinId = detail?.["joinId"] ?? "";
        name = "";
        isHost = (detail?.["isHost"] === true);
        mode = MODE_DIRECT;
        if (roomKey === "") {
            return;
        }
        startKeys();
        startDirectClock();
        createConnection();

        state = "connecting";
        emit("connecting", {"roomKey": roomKey, "isHost": isHost});
        console.log("Room " + roomKey + " open as " + (isHost === true ? "host" : "peer"));
        replayHeldSignals();
    };

    const onSignal = async function(detail) {
        const signal = detail?.["signal"] ?? {};
        if (detail?.["roomKey"] !== roomKey || (connection === null && signal["kind"] !== "direct" && signal["kind"] !== "key")) {
            holdSignal(detail);
            return;
        }
        try {
            // the other end's half of the seal - the first one only, so a key
            // slipped in later cannot re-key a room that is already sealed
            if (signal["kind"] === "key") {
                if (otherKey === "" && typeof signal["key"] === "string") {
                    otherKey = signal["key"];
                    await startSeal();
                }
                return;
            }
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
            // or is on the relay and asks for the direct path again
            if (signal["kind"] === "direct") {
                startDirect(true);
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
            videoChannel?.close?.();
            connection?.close?.();
        } catch (error) {
            console.error("Cannot close the connection:", error);
        }
        channelCom = null;
        channel = null;
        videoChannel = null;
        connection = null;
        earlyCandidates.length = 0;
    };

    // everything this client holds of the connection, and nothing about the
    // server's half of it - which is why the two ways out below are different.
    // `isRemote` is a close the server reported: the reason is then the other
    // side's doing, and "left" means it left rather than that this side did.
    const teardown = function(reason, isRemote = false) {
        const closedRoomKey = roomKey;
        roomKey = "";
        joinId = "";
        name = "";
        mode = MODE_DIRECT;
        clearTimeout(directTimeoutId);
        directTimeoutId = -1;

        closeConnection();
        earlySignals.clear();
        dropSeal();

        if (state === "closed") {
            return "";
        }
        state = "closed";
        console.log("Room " + closedRoomKey + " closed (" + reason + (isRemote === true ? ", by the other side" : "") + ")");
        emit("closed", {"roomKey": closedRoomKey, "reason": reason, "isRemote": isRemote === true});
        return closedRoomKey;
    };

    // this side is done with it, so the other one is told through the server -
    // the room goes with it and nothing is left holding a socket open
    const leave = function(reason = "left") {
        const closedRoomKey = teardown(reason);
        if (closedRoomKey !== "") {
            ctx["server"].roomLeave(closedRoomKey);
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
        if (event.detail?.["roomKey"] !== roomKey) {
            return;
        }

        // everything the other end relays is sealed bytes, so anything else -
        // the server's own JSON path, or an unsealed frame - is the server's
        // writing and not the other end's
        const data = event.detail?.["data"];
        if ((data instanceof ArrayBuffer) === false) {
            console.warn("Room " + roomKey + " dropped an unsealed relayed message");
            return;
        }
        if (seal === null) {
            if (earlyRelay.length < EARLY_MAX) {
                earlyRelay.push(data);
            }
            return;
        }
        openRelayed(data);
    });

    // the other end left, or its socket did: the room is already gone on the
    // server, so this one only takes itself down
    ctx["server"].addEventListener("room-close", function(event) {
        if (event.detail?.["roomKey"] !== roomKey) {
            return;
        }
        teardown(event.detail?.["reason"] ?? "closed", true);
    });

    // the socket went, and the server ended the room with it - telling only the
    // other side, since this one was not there to hear (see CLIENT.md)
    ctx["server"].addEventListener("offline", function() {
        if (roomKey !== "") {
            teardown("gone", true);
        }
    });

    return {
        "addEventListener": events.addEventListener.bind(events),
        "removeEventListener": events.removeEventListener.bind(events),

        "leave": leave,

        // one way out for whatever the two ends have to say, whichever of the two
        // is carrying it: the control protocol and the settings of the stream
        // (src/room/stream.js), answered and in order. A relayed message is a call
        // the server answers, so this one reports rather than throws. The
        // frames themselves take sendFrame below.
        "send": async function(data) {
            if (state !== "connected") {
                return false;
            }
            if (mode === MODE_RELAY) {
                // everything goes as a frame, bytes or not: the communicator
                // splits those into packets, so this is the one path with no
                // size to stay under and there is no reason to keep a second -
                // and every one of them sealed, bytes or not
                if (roomKey === "" || seal === null) {
                    return false;
                }
                try {
                    return await relay(data);
                } catch (error) {
                    console.error("Cannot relay a message:", error);
                    return false;
                }
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

        // one chunk of the stream, on whichever leg is carrying the room. Bytes
        // only, and nothing waits for them: a chunk the channel will not take
        // right now is refused - reported false - rather than queued behind the
        // ones already there, because a queue here is latency the peer sees.
        // Over the relay it is a socket frame, and the socket splits it itself.
        "sendFrame": function(buffer) {
            if (state !== "connected" || (buffer instanceof ArrayBuffer) === false) {
                return false;
            }
            if (mode === MODE_RELAY) {
                // what is still being sealed is on its way to the socket too
                if (roomKey === "" || seal === null || ctx["server"].getBufferedAmount() + sealingBytes > RELAY_BACKLOG) {
                    return false;
                }
                relay(buffer).catch(function(error) {
                    console.error("Cannot relay a frame:", error);
                });
                return true;
            }
            if (videoChannel === null || videoChannel.readyState !== "open") {
                return false;
            }
            if (videoChannel.bufferedAmount > VIDEO_BACKLOG) {
                return false;
            }
            try {
                videoChannel.send(buffer);
                return true;
            } catch (error) {
                console.error("Cannot send a frame:", error);
                return false;
            }
        },

        // the most sendFrame takes in one call: one SCTP message on the direct
        // leg, since the channel is not wrapped in anything that would split
        // it; anything at all on the relay, where the socket does
        "getFrameLimit": function() {
            return (mode === MODE_RELAY ? Infinity : CHANNEL_PACKET_SIZE);
        },

        "getState": function() {
            return state;
        },
        "getMode": function() {
            return mode;
        },
        "isRelayAllowed": isRelayAllowed,
        "isRelay": function() {
            return mode === MODE_RELAY;
        },
        // whether a direct connection is being tried again from the relay
        "isTryingDirect": function() {
            return mode === MODE_RELAY && connection !== null;
        },

        // the path by hand, from the room bar: onto the relay, or a direct
        // connection tried again from it. Both are the same moves the failures
        // make on their own, so the other end follows either the same way.
        "useRelay": function() {
            if (state !== "connected" || isRelayAllowed() === false) {
                return;
            }
            startRelay(false);
        },
        "useDirect": function() {
            if (state !== "connected") {
                return;
            }
            startDirect(false);
        },
        "isConnected": function() {
            return state === "connected";
        },
        "getRoomKey": function() {
            return roomKey;
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
            emit("name", {"roomKey": roomKey, "name": name});
        },

        // whether this client is sharing itself out right now. It is the room
        // and not the record that answers: a pairing nobody remembered leaves
        // no record to ask, and it is a share for as long as it stands - which
        // is what the shares screen and the badge of the two bars draw.
        "isSharing": function() {
            return isHost === true && state !== "closed";
        },

        // the two objects behind the room, for whatever has to look at them
        "getConnection": function() {
            return connection;
        },
        "getChannel": function() {
            return channel;
        },
        "getVideoChannel": function() {
            return videoChannel;
        },

        // the protocol over whichever leg is carrying the room: the channel's
        // own communicator here, and ctx["server"]'s for a relayed room
        "getCommunicator": function() {
            return channelCom;
        }
    };
};

export { createRoom, isOfferer, CHANNEL_NAME, VIDEO_CHANNEL_NAME, VIDEO_BACKLOG, RELAY_BACKLOG, DIRECT_TIMEOUT, CLOSE_GRACE };
export default { createRoom, isOfferer, CHANNEL_NAME, VIDEO_CHANNEL_NAME, VIDEO_BACKLOG, RELAY_BACKLOG, DIRECT_TIMEOUT, CLOSE_GRACE };
