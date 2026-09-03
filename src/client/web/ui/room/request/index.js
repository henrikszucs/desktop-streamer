"use strict";

// somebody wants in: who they are, and how long there is to answer. Closing it
// rejects, which is why it does not close on a click outside.
//
// Both answers went with the pairing server (dev/plans/ws-pairing-joins.md), so
// nothing opens this dialog today and neither button answers anybody.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const RoomRequestDialog = class extends Dialog {
    static id = "room-request";
    static rootId = "dialog-room-request";
    static closeOnOverlay = false;

    // timeout and auto updates
    timeout = 1000;
    startTime = -1;
    updateIntervalId = -1;
    timeoutId = -1;

    async mount(ctx) {
        this.info = document.getElementById("dialog-room-request-info");
        this.rememberBtn = document.getElementById("btn-request-remember");
        this.rememberLabel = document.getElementById("btn-request-remember-label");
        this.rejectBar = document.getElementById("room-request-reject-bar");

        document.getElementById("btn-request-reject").addEventListener("click", () => {
            this.requestClose();
        });
        document.getElementById("btn-request-accept").addEventListener("click", () => {
            console.warn("Pairing is not wired to the server yet");
        });
    };

    open(params) {
        this.info.innerHTML = params["info"];
        this.timeout = params["timeout"];
        this.rememberBtn.checked = false;
        if (params["showRemember"] === true) {
            this.rememberLabel.classList.remove("hide");
        } else {
            this.rememberLabel.classList.add("hide");
        }

        super.open(params);

        this.startTime = Date.now();
        this.updateIntervalId = setInterval(() => {
            const progress = (Date.now() - this.startTime) / this.timeout * 10000;
            this.rejectBar.value = progress;
        }, 16);

        this.timeoutId = setTimeout(() => {
            this.requestClose();
        }, this.timeout);
    };
    close() {
        clearInterval(this.updateIntervalId);
        clearTimeout(this.timeoutId);
        this.updateIntervalId = -1;
        this.timeoutId = -1;
        super.close();
    };
};

export { RoomRequestDialog };
export default RoomRequestDialog;
