"use strict";

// the transport the whole UI talks to the server through, built once by the shell
// and handed to every module in ctx - cut back to what ws.js answers today

// third-party dependencies
import Communicator from "../libs/communicator/communicator.js";

// first-party dependencies
import { conf } from "./conf.js";

// what the server may say on its own, each handed on as an event of that name
const PUSH_EVENTS = new Set([
    "pair-request", "pair-accept", "pair-reject", "pair-cancel", "pair-code",
    "join-request", "join-accept", "join-reject", "join-cancel", "join-remove",
    "join-online",
    "room-open", "room-signal", "room-data", "room-close"
]);

// The binary relay frame, the same bytes the server reads (see
// src/server/ws/handlers/rooms.js):
//
//   [0]      the frame kind - 1 for bytes, 2 for a JSON payload
//   [1..10]  this client's own room key, one byte per character
//   [11..]   the payload
//
// Everything the relay carries becomes bytes - which is what the two kinds are
// for - so nothing sent over it has a size to stay under.
//
// The key that goes out is not the key that arrives: each side holds its own,
// and the server writes the receiver's over the sender's on the way through, so
// a frame never carries one side's credential to the other.
const FRAME_DATA = 1;
const FRAME_JSON = 2;
const ROOM_KEY_LENGTH = 10;
const FRAME_HEADER = 1 + ROOM_KEY_LENGTH;

// how long one frame is given to cross, whole rather than packet by packet
const DATA_TIMEOUT = 60000;

const buildRoomFrame = function(roomKey, data) {
    const isBinary = (data instanceof ArrayBuffer);
    const payload = (isBinary === true
        ? new Uint8Array(data)
        : new TextEncoder().encode(JSON.stringify(data)));

    const bytes = new Uint8Array(FRAME_HEADER + payload.byteLength);
    bytes[0] = (isBinary === true ? FRAME_DATA : FRAME_JSON);
    for (let i = 0; i < ROOM_KEY_LENGTH; i++) {
        bytes[1 + i] = roomKey.charCodeAt(i);
    }
    bytes.set(payload, FRAME_HEADER);
    return bytes.buffer;
};

// and back: the room it belongs to and the payload, or nothing for a frame this
// client has no way to read
const readRoomFrame = function(buffer) {
    if (buffer.byteLength <= FRAME_HEADER) {
        return undefined;
    }
    const header = new Uint8Array(buffer, 0, FRAME_HEADER);
    if (header[0] !== FRAME_DATA && header[0] !== FRAME_JSON) {
        return undefined;
    }
    let roomKey = "";
    for (let i = 1; i < FRAME_HEADER; i++) {
        roomKey += String.fromCharCode(header[i]);
    }

    const payload = buffer.slice(FRAME_HEADER);
    if (header[0] === FRAME_DATA) {
        return {"roomKey": roomKey, "data": payload};
    }

    // what went in as an object comes out as one - a frame that cannot be read
    // back is a frame from something this client does not understand
    try {
        return {"roomKey": roomKey, "data": JSON.parse(new TextDecoder().decode(payload))};
    } catch (error) {
        console.error("Cannot read a relayed message:", error);
        return undefined;
    }
};

// events:
// online, offline, version-mismatch,
// pair-request, pair-accept, pair-reject, pair-cancel, pair-code,
// join-request, join-accept, join-reject, join-cancel, join-remove, join-online,
// room-open, room-signal, room-data, room-close
const Server = class extends EventTarget {
    address = "";
    ws = null;
    communicator = null;
    isOnline = false;
    isOutdated = false;
    constructor() {
        super();
    };
    connect(address) {
        //events: online / offline
        this.address = address;
        this.communicator = new Communicator({
            "sender": function() {},
            "interactTimeout": 3000,    //the max timeout between two packet arrive
            "timeout": 5000,            //the time for transmit message
            "packetSize": 1000,         //the maximum size of one packet in bytes (only for ArrayBuffer)
            "packetTimeout": 1000,      //the max timeout for packets
            "packetRetry": Infinity,    //number of retring attemts for one packet
            "sendThreads": 16
        });

        this.reconnect();
    };
    reconnect() {
        this.ws?.close?.();

        //create connection
        this.ws = new WebSocket(this.address);
        this.ws.binaryType = "arraybuffer";

        // listen for incoming requests
        this.communicator.onIncoming((messageObj) => {
            this.handleIncoming(messageObj);
        });

        // configure sernder fn
        this.communicator.configure({
            "sender": async (data) => {
                if ((data instanceof ArrayBuffer) === false) {
                    data = JSON.stringify(data);
                }
                this.ws.send(data);
            }
        });

        // configure receiver fn
        this.ws.addEventListener("message", (event) => {
            console.log("Received data:", event.data);
            let data = event.data;
            if (typeof data === "string") {
                data = JSON.parse(data);
            }
            this.communicator.receive(data);
        });

        // connection finishing
        this.ws.addEventListener("open", async () => {
            // sync
            await this.communicator.sideSync();
            await this.communicator.timeSync();

            // nothing goes online without it, and wait() reports a failed call
            // in message.error instead of throwing, so it is checked not caught
            const message = this.communicator.invoke({"type":"conf-get"});
            await message.wait();
            if (message.error !== "" || typeof message.data !== "object" || message.data["success"] === false) {
                console.error("Failed to get server configuration:", message.error);
                this.ws.close();
                return;
            }
            conf["remote"] = message.data;

            // this build against the build of the server answering it: they may
            // differ, nothing past this point may, so a mismatch ends here
            if (conf["remote"]["version"] !== conf["version"]) {
                console.error("Version mismatch, client:", conf["version"], "server:", conf["remote"]["version"]);
                this.isOutdated = true;
                this.dispatchEvent(new CustomEvent("version-mismatch", {
                    "detail": {
                        "client": conf["version"],
                        "server": conf["remote"]["version"]
                    }
                }));
                this.ws.close();
                return;
            }

            // allow online
            console.log("connected");
            this.isOnline = true;

            // trigger online
            this.dispatchEvent(new CustomEvent("online"));
        }, { "once": true });

        // an outdated client does not reconnect: it would fail the same check
        // every two seconds, under the mismatch the shell just showed
        const handleDisconnection = () => {
            this.ws.removeEventListener("error", handleError);
            this.ws.removeEventListener("close", handleClose);
            this.isOnline = false;
            if (this.isOutdated === true) {
                return;
            }
            this.dispatchEvent(new CustomEvent("offline"));
            setTimeout(() => {
                this.reconnect();
            }, 2000);
        };
        const handleError = () => {
            console.log("disconnected");
            handleDisconnection();
        };
        this.ws.addEventListener("error", handleError, { "once": true });
        const handleClose = () => {
            console.log("close");
            handleDisconnection();
        };
        this.ws.addEventListener("close", handleClose, { "once": true });
    };
    //
    // pairing
    //
    // the connection code this device hands out. The server is what makes it, so
    // there is one code for this socket, it stands while this socket offers it,
    // and it is gone when the socket is.
    //
    // What is thrown carries the reason as its message - the server's own error
    // name, or the transport's when the call never got an answer - because the
    // caller is what turns a reason into something a user reads.
    async createPairCode() {
        const messageObj = this.communicator.invoke({"type": "pair-create"});
        await messageObj.wait();
        if (messageObj.error !== "") {
            throw new Error(messageObj.error);
        }
        if (typeof messageObj.data !== "object" || messageObj.data["success"] !== true) {
            throw new Error(messageObj.data?.["error"] ?? "failed");
        }
        return messageObj.data["pairCode"];
    };

    // give the code back before the socket does. An offline client has none to
    // give - the server dropped it with the connection.
    async deletePairCode() {
        if (this.isOnline === false) {
            return;
        }
        const messageObj = this.communicator.invoke({"type": "pair-delete"});
        await messageObj.wait();
    };

    // ask the host behind a code to let this device in. The answer only says
    // that the host was asked and how long it has to answer - the answer itself
    // arrives on its own, as a pair-accept or a pair-reject.
    async pairRequest(pairCode) {
        const messageObj = this.communicator.invoke({"type": "pair-request", "pairCode": pairCode});
        await messageObj.wait();
        if (messageObj.error !== "") {
            throw new Error(messageObj.error);
        }
        if (typeof messageObj.data !== "object" || messageObj.data["success"] !== true) {
            throw new Error(messageObj.data?.["error"] ?? "failed");
        }
        return {"timeout": messageObj.data["timeout"]};
    };

    // the host's answer to the request it was asked. Remembering it is the host's
    // to decide, and what comes back is the join both sides are then on - the
    // code in it is this side's own.
    async pairAccept(isRemember=false, isUnsupervised=false) {
        const messageObj = this.communicator.invoke({
            "type": "pair-accept",
            "remember": isRemember === true,
            "unsupervised": isUnsupervised === true
        });
        await messageObj.wait();
        if (messageObj.error !== "") {
            throw new Error(messageObj.error);
        }
        if (typeof messageObj.data !== "object" || messageObj.data["success"] !== true) {
            throw new Error(messageObj.data?.["error"] ?? "failed");
        }
        return messageObj.data;
    };

    // no, from either side: the host deciding against it, or the peer giving up
    // the wait. Nothing to refuse is not an error, so this one only reports.
    async pairReject() {
        if (this.isOnline === false) {
            return;
        }
        const messageObj = this.communicator.invoke({"type": "pair-reject"});
        await messageObj.wait();
    };

    //
    // joins
    //
    // a remembered pairing, presented by the code this side kept. Both sides do
    // it for every join they hold: a host that is not on its own joins cannot be
    // asked about them, and neither side knows who is online without it.
    async joinConnect(joinCode) {
        const messageObj = this.communicator.invoke({"type": "join-connect", "joinCode": joinCode});
        await messageObj.wait();
        if (messageObj.error !== "") {
            throw new Error(messageObj.error);
        }
        if (typeof messageObj.data !== "object" || messageObj.data["success"] !== true) {
            throw new Error(messageObj.data?.["error"] ?? "failed");
        }
        return messageObj.data;
    };

    // who is online, of the joins this connection is on
    async joinList() {
        const messageObj = this.communicator.invoke({"type": "join-list"});
        await messageObj.wait();
        if (messageObj.error !== "" || messageObj.data?.["success"] !== true) {
            return [];
        }
        return messageObj.data["joins"] ?? [];
    };

    // the peer asks to come back in. An unsupervised join answers it here and
    // now; a supervised one answers with the window the host has, and the
    // decision arrives on its own as a join-accept or a join-reject.
    async joinRequest(joinId) {
        const messageObj = this.communicator.invoke({"type": "join-request", "joinId": joinId});
        await messageObj.wait();
        if (messageObj.error !== "") {
            throw new Error(messageObj.error);
        }
        if (typeof messageObj.data !== "object" || messageObj.data["success"] !== true) {
            throw new Error(messageObj.data?.["error"] ?? "failed");
        }
        return messageObj.data;
    };

    async joinAccept(joinId) {
        const messageObj = this.communicator.invoke({"type": "join-accept", "joinId": joinId});
        await messageObj.wait();
        if (messageObj.error !== "") {
            throw new Error(messageObj.error);
        }
        if (typeof messageObj.data !== "object" || messageObj.data["success"] !== true) {
            throw new Error(messageObj.data?.["error"] ?? "failed");
        }
    };

    // no, from either side of a join: the host deciding against it, or the peer
    // giving up the wait
    async joinReject(joinId) {
        if (this.isOnline === false) {
            return;
        }
        const messageObj = this.communicator.invoke({"type": "join-reject", "joinId": joinId});
        await messageObj.wait();
    };

    // what this client calls the other side. The name is the caller's own column
    // on the row, so join-connect hands it back and the other side never sees it.
    async joinRename(joinId, name) {
        const messageObj = this.communicator.invoke({"type": "join-rename", "joinId": joinId, "name": name});
        await messageObj.wait();
        if (messageObj.error !== "") {
            throw new Error(messageObj.error);
        }
        if (typeof messageObj.data !== "object" || messageObj.data["success"] !== true) {
            throw new Error(messageObj.data?.["error"] ?? "failed");
        }
    };

    // either side forgets the other for good - the row goes with it
    async joinDelete(joinId) {
        const messageObj = this.communicator.invoke({"type": "join-delete", "joinId": joinId});
        await messageObj.wait();
        return messageObj.error === "" && messageObj.data?.["success"] === true;
    };

    //
    // the room
    //
    // one signal to the other end of the room this connection is in. The server
    // carries it and reads nothing of it: what is inside is between the two
    // clients (see src/room.js).
    async roomSignal(roomKey, signal) {
        const messageObj = this.communicator.invoke({"type": "room-signal", "roomKey": roomKey, "signal": signal});
        await messageObj.wait();
        if (messageObj.error !== "") {
            throw new Error(messageObj.error);
        }
        if (typeof messageObj.data !== "object" || messageObj.data["success"] !== true) {
            throw new Error(messageObj.data?.["error"] ?? "failed");
        }
    };

    // the fallback, when the two ends could not reach each other: what would
    // have gone over the connection goes through the server instead. It is
    // refused unless the configuration allows it (`guestAllowRelay`), which is
    // why the caller is told rather than left to wonder.
    async roomData(roomKey, data) {
        const messageObj = this.communicator.invoke({"type": "room-data", "roomKey": roomKey, "data": data});
        await messageObj.wait();
        if (messageObj.error !== "") {
            throw new Error(messageObj.error);
        }
        if (typeof messageObj.data !== "object" || messageObj.data["success"] !== true) {
            throw new Error(messageObj.data?.["error"] ?? "failed");
        }
    };

    // The relay's own path, and the one with no size to stay under: whatever is
    // handed in becomes bytes and the communicator splits those into packets, so
    // a frame is as big as the two ends want it to be.
    //
    // It is *sent* rather than invoked: the answer would be one more round trip
    // per frame and a stream cannot wait for one. What it reports is that the
    // frame left, which is what backpressure needs.
    async roomDataSend(roomKey, data) {
        const frame = buildRoomFrame(roomKey, data);
        const messageObj = this.communicator.send(frame, [frame], DATA_TIMEOUT);
        await messageObj.wait();
        return messageObj.error === "";
    };

    // this side is done with the room. A room that is already gone is not an
    // error - it is what the caller wanted - so this one only reports.
    async roomLeave(roomKey) {
        if (this.isOnline === false) {
            return;
        }
        const messageObj = this.communicator.invoke({"type": "room-leave", "roomKey": roomKey});
        await messageObj.wait();
    };

    // what the server says on its own. The pairing flow is the whole of it
    // today: the host hears that somebody wants in, both sides hear how it
    // ended, and the host hears the code it was given in place of a refused
    // one - and either side of a remembered join hears the other arrive or go.
    // The room is the other half: both ends are told they are in one, what the
    // other is signaling, and when it is over.
    // Each becomes an event of the same name, with the message as detail.
    async handleIncoming(messageObj) {
        await messageObj.wait();
        const message = messageObj.data;

        // a frame the relay carried, which has no type of its own - it is the
        // same "room-data" the JSON call makes, with an ArrayBuffer in it
        if (message instanceof ArrayBuffer) {
            const frame = readRoomFrame(message);
            if (typeof frame === "undefined") {
                console.warn("Unhandled incoming frame of " + message.byteLength + " bytes");
                return;
            }
            this.dispatchEvent(new CustomEvent("room-data", {"detail": {
                "type": "room-data",
                "roomKey": frame["roomKey"],
                "data": frame["data"]
            }}));
            return;
        }

        const type = message?.["type"];
        if (PUSH_EVENTS.has(type) === false) {
            console.warn("Unhandled incoming message:", message);
            return;
        }
        this.dispatchEvent(new CustomEvent(type, {"detail": message}));
    };
};
export { Server, buildRoomFrame, readRoomFrame, FRAME_DATA, FRAME_JSON, FRAME_HEADER };
export default Server;
