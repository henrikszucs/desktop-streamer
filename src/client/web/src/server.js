"use strict";

// the transport the whole UI talks to the server through, built once by the shell
// and handed to every module in ctx - cut back to what ws.js answers today

// third-party dependencies
import Communicator from "../libs/communicator/communicator.js";

// first-party dependencies
import { conf } from "./conf.js";

// what the server may say on its own, each handed on as an event of that name
const PUSH_EVENTS = new Set(["pair-request", "pair-accept", "pair-reject", "pair-cancel", "pair-code"]);

// events:
// online, offline, version-mismatch,
// pair-request, pair-accept, pair-reject, pair-cancel, pair-code
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

    // the host's answer to the request it was asked
    async pairAccept() {
        const messageObj = this.communicator.invoke({"type": "pair-accept"});
        await messageObj.wait();
        if (messageObj.error !== "") {
            throw new Error(messageObj.error);
        }
        if (typeof messageObj.data !== "object" || messageObj.data["success"] !== true) {
            throw new Error(messageObj.data?.["error"] ?? "failed");
        }
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

    // what the server says on its own. The pairing flow is the whole of it
    // today: the host hears that somebody wants in, both sides hear how it
    // ended, and the host hears the code it was given in place of a refused
    // one. Each becomes an event of the same name, with the message as detail.
    async handleIncoming(messageObj) {
        await messageObj.wait();
        const message = messageObj.data;
        const type = message?.["type"];
        if (PUSH_EVENTS.has(type) === false) {
            console.warn("Unhandled incoming message:", message);
            return;
        }
        this.dispatchEvent(new CustomEvent(type, {"detail": message}));
    };
};
export { Server };
export default Server;
