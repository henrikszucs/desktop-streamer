"use strict";

// the transport the whole UI talks to the server through: one WebSocket and the
// packetized communicator on top of it. It is not a UI module - the shell builds
// it once and hands it to every module in ctx.
//
// It was cut back to what `src/server/ws.js` answers today: the socket
// lifecycle and `conf-get`. Sign-in, user data, pair codes and joins went with
// the server side of them and are planned in `dev/plans/`, with the previous
// implementation at commit `da3921d`. That code read message types the server no
// longer serves, so do not paste it back untouched.

// third-party dependencies
import Communicator from "../libs/communicator/communicator.js";

// first-party dependencies
import { conf } from "./conf.js";

// events:
// online, offline
const Server = class extends EventTarget {
    address = "";
    ws = null;
    communicator = null;
    isOnline = false;
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

            // get server conf. Nothing here goes online without it, and wait()
            // reports a failed call in message.error instead of throwing, so the
            // answer has to be checked rather than caught.
            const message = this.communicator.invoke({"type":"conf-get"});
            await message.wait();
            if (message.error !== "" || typeof message.data !== "object" || message.data["success"] === false) {
                console.error("Failed to get server configuration:", message.error);
                this.ws.close();
                return;
            }
            conf["ws"]["remote"] = message.data;

            // allow online
            console.log("connected");
            this.isOnline = true;

            // trigger online
            this.dispatchEvent(new CustomEvent("online"));
        }, { "once": true });

        // handle disconnection
        const handleDisconnection = () => {
            this.ws.removeEventListener("error", handleError);
            this.ws.removeEventListener("close", handleClose);
            this.isOnline = false;
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
    // nothing the server pushes on its own is served yet - the message is read
    // to its end so the communicator can close it, and logged
    async handleIncoming(messageObj) {
        await messageObj.wait();
        console.warn("Unhandled incoming message:", messageObj.data);
    };
};
export { Server };
export default Server;
