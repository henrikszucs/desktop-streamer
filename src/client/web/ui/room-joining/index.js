"use strict";

// waiting for the host to answer a join request, with the bar that runs out
// when the request times out. Closing it gives the request up, which is not the
// same as the host rejecting it, so it says so with a "cancel" event.
//
// The request it waits on went with the pairing server
// (dev/plans/ws-pairing-joins.md), so nothing opens this dialog today and the
// "cancel" event has nothing to call off on the server.

// first-party dependencies
import { Dialog } from "../../src/view.js";

const RoomJoiningDialog = class extends Dialog {
    static id = "room-joining";
    static rootId = "dialog-room-joining";

    // timeout and auto updates
    timeout = 1000;
    startTime = -1;
    updateIntervalId = -1;

    async mount(ctx) {
        this.progressBar = document.getElementById("room-joining-progress");
        this.info = document.getElementById("dialog-room-joining-info");

        document.getElementById("btn-room-joining-close").addEventListener("click", () => {
            this.requestClose();
        });
    };

    requestClose() {
        this.dispatchEvent(new CustomEvent("cancel"));
        super.requestClose();
    };

    open(params) {
        this.info.innerHTML = params["info"];
        this.timeout = params["timeout"];

        super.open(params);

        this.startTime = Date.now();
        this.updateIntervalId = setInterval(() => {
            const progress = (Date.now() - this.startTime) / this.timeout * 10000;
            this.progressBar.value = progress;
        }, 16);
    };
    close() {
        clearInterval(this.updateIntervalId);
        this.updateIntervalId = -1;
        super.close();
    };
};

export { RoomJoiningDialog };
export default RoomJoiningDialog;
