"use strict";

// somebody wants in: who they are, and how long there is to answer. The bar runs
// across the reject button because that is what happens on its own - saying
// nothing is saying no - so the button it fills is the one that will act.
//
// It never talks to the server from close(): the flow can end from the other
// side too (the one waiting gave up, or the server ran the clock out), and the
// dialog is closed for it. Only the two answers below reach the server.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

// how often the bar is redrawn - about once a frame
const TICK = 16;

// the bar is drawn against this, not against seconds, so the same markup fits
// any timeout the server names
const BAR_MAX = 10000;

// the server holds the real clock. This one is answered just before it runs out,
// so the host's own reject is what the other side hears rather than a timeout
// the host was never told about.
const ANSWER_MARGIN = 500;

const RoomRequestDialog = class extends Dialog {
    static id = "room-request";
    static rootId = "dialog-room-request";
    static closeOnOverlay = false;

    // timeout and auto updates
    timeout = 1000;
    startTime = -1;
    updateIntervalId = -1;
    timeoutId = -1;

    // one answer per request: the click that lands a moment after the clock ran
    // out is not a second one
    isAnswered = false;

    async mount(ctx) {
        this.info = document.getElementById("dialog-room-request-info");
        this.rememberBtn = document.getElementById("btn-request-remember");
        this.rememberLabel = document.getElementById("btn-request-remember-label");
        this.rejectBar = document.getElementById("room-request-reject-bar");

        document.getElementById("btn-request-reject").addEventListener("click", () => {
            this.reject();
        });
        document.getElementById("btn-request-accept").addEventListener("click", () => {
            this.accept();
        });
    };

    //
    // the two answers
    //
    async accept() {
        if (this.answer() === false) {
            return;
        }
        try {
            await this.ctx["server"].pairAccept();
            this.ctx["ui"].snackbar.show(this.ctx["localization"].get("new.share.accepted"));
            this.finish(true);
        } catch (error) {
            console.error(error);
            this.ctx["ui"].snackbar.show(this.ctx["localization"].get("new.share.answer-failed"), true);
            this.finish(false);
        }
    };

    reject() {
        if (this.answer() === false) {
            return;
        }
        this.ctx["server"].pairReject();
        this.ctx["ui"].snackbar.show(this.ctx["localization"].get("new.share.rejected"));
        this.finish(false);
    };

    // one answer per request, and the dialog goes at once: the call that carries
    // it may take a moment, and nothing on screen is waiting for that
    answer() {
        if (this.isAnswered === true) {
            return false;
        }
        this.isAnswered = true;
        this.ctx["ui"].closeDialog(this.constructor.id);
        return true;
    };

    // what the dialog that opened this one waits for, and it is dispatched only
    // once the answer has actually left. Tearing the flow down closes the share
    // dialog, which gives the code back - and a code given back while a request
    // is still pending is a rejection, which would undo the accept above.
    finish(isAccepted) {
        this.dispatchEvent(new CustomEvent("done", {"detail": {"isAccepted": isAccepted}}));
    };

    // the close button of a dialog is its reject here, and so is the clock
    requestClose() {
        this.reject();
    };

    open(params) {
        this.info.innerHTML = params["info"];
        this.timeout = params["timeout"];
        this.isAnswered = false;
        this.rememberBtn.checked = false;
        if (params["showRemember"] === true) {
            this.rememberLabel.classList.remove("hide");
        } else {
            this.rememberLabel.classList.add("hide");
        }

        super.open(params);

        this.startTime = Date.now();
        this.rejectBar.value = 0;
        this.updateIntervalId = setInterval(() => {
            const progress = (Date.now() - this.startTime) / this.timeout * BAR_MAX;
            this.rejectBar.value = Math.min(progress, BAR_MAX);
        }, TICK);

        // the server is the one holding the real clock; this one runs a moment
        // early so the host sees its own decision rather than a timeout
        this.timeoutId = setTimeout(() => {
            this.reject();
        }, Math.max(this.timeout - ANSWER_MARGIN, 0));
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
