"use strict";

// the wait for the host's answer. It owns the request from the click that opened
// it: it asks, it draws how long there is left, and it hears the answer. Closing
// it gives the wait up, which is not a rejection - hence "cancel".

// first-party dependencies
import { Dialog } from "../../../src/view.js";

// how often the bar is redrawn - about once a frame
const TICK = 16;

// the bar is drawn against this, not against seconds, so the same markup fits
// any timeout the server names
const BAR_MAX = 10000;

// why the wait ended, in the words the one waiting reads
const REJECT_TEXTS = new Map([
    ["rejected", "new.join.rejected"],
    ["timeout", "new.join.no-answer"],
    ["gone", "new.join.host-gone"]
]);

// and why it never started
const ERROR_TEXTS = new Map([
    ["unknown-code", "new.join.unknown-code"],
    ["invalid-code", "new.join.code-invalid"],
    ["own-code", "new.join.own-code"],
    ["busy", "new.join.busy"],
    ["not-allowed", "new.join.denied"]
]);

const RoomJoiningDialog = class extends Dialog {
    static id = "room-joining";
    static rootId = "dialog-room-joining";

    // timeout and auto updates
    timeout = 1000;
    startTime = -1;
    updateIntervalId = -1;

    // which ask this is. The request is a call like any other - a slow answer to
    // one that was already given up on must not start a countdown.
    requestId = 0;

    async mount(ctx) {
        this.progressBar = document.getElementById("room-joining-progress");
        this.info = document.getElementById("dialog-room-joining-info");

        document.getElementById("btn-room-joining-close").addEventListener("click", () => {
            this.requestClose();
        });
    };

    //
    // the request
    //
    // the host is asked, and only then is there a length to draw: until the
    // server answers, the bar says "something is happening" and no more
    async request(pairCode) {
        const requestId = ++this.requestId;
        const localization = this.ctx["localization"];
        this.displayWait(localization.get("new.join.dialog-asking"), 0);
        try {
            const request = await this.ctx["server"].pairRequest(pairCode);
            if (requestId !== this.requestId) {
                return;     // this dialog was closed, or asked again, meanwhile
            }
            const timeout = request["timeout"] ?? this.ctx["conf"]["remote"]?.["pairing"]?.["answerTimeout"];
            this.displayWait(localization.get("new.join.dialog-waiting"), timeout);
        } catch (error) {
            console.error(error);
            if (requestId !== this.requestId) {
                return;
            }
            this.finish(localization.get(ERROR_TEXTS.get(error.message) ?? "new.join.failed"));
        }
    };

    // the wait, with a length or without one: a bar with no value of its own is
    // the indeterminate one, which is what an unanswered request is
    displayWait(text, timeout) {
        clearInterval(this.updateIntervalId);
        this.info.innerText = text;

        if (typeof timeout !== "number" || timeout <= 0) {
            this.progressBar.removeAttribute("value");
            this.updateIntervalId = -1;
            return;
        }
        this.timeout = timeout;
        this.startTime = Date.now();
        this.progressBar.value = 0;
        this.updateIntervalId = setInterval(() => {
            const progress = (Date.now() - this.startTime) / this.timeout * BAR_MAX;
            this.progressBar.value = Math.min(progress, BAR_MAX);
        }, TICK);
    };

    // the end of it, whichever way it went: what happened is said in the
    // snackbar, because the dialog that would have said it is going away
    finish(message) {
        this.requestId++;
        this.ctx["ui"].snackbar.show(message, true);
        this.ctx["ui"].closeDialog(this.constructor.id);
    };

    //
    // the answer, which arrives on its own
    //
    onPairAccept = () => {
        this.requestId++;
        this.ctx["ui"].snackbar.show(this.ctx["localization"].get("new.join.accepted"));
        this.ctx["ui"].closeDialog(this.constructor.id);
        // the room this leads into is still ahead: dev/plans/ws-pairing-joins.md
    };
    onPairReject = (event) => {
        const reason = event.detail?.["reason"];
        this.finish(this.ctx["localization"].get(REJECT_TEXTS.get(reason) ?? "new.join.rejected"));
    };

    // giving up the wait is the one thing that has to reach the server: the host
    // is looking at a dialog that should come down with it
    requestClose() {
        this.requestId++;
        this.ctx["server"].pairReject();
        super.requestClose();
    };

    open(params) {
        super.open(params);
        const server = this.ctx["server"];
        server.addEventListener("pair-accept", this.onPairAccept);
        server.addEventListener("pair-reject", this.onPairReject);
        this.request(params["pairCode"]);
    };
    close() {
        // nothing is sent from here: close() is also how the flow ends itself,
        // and an answer that already arrived must not be answered back
        this.requestId++;
        clearInterval(this.updateIntervalId);
        this.updateIntervalId = -1;

        const server = this.ctx["server"];
        server.removeEventListener("pair-accept", this.onPairAccept);
        server.removeEventListener("pair-reject", this.onPairReject);

        super.close();
    };
};

export { RoomJoiningDialog };
export default RoomJoiningDialog;
