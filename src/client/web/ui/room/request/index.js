"use strict";

// somebody wants in: who they are, and how long there is to answer. The bar runs
// across the reject button because that is what happens on its own - saying
// nothing is saying no - so the button it fills is the one that will act.
//
// It answers both flows. Pairing goes through the share dialog, which opens this
// one and waits for the `done` event; a remembered device that comes back is
// answered here whatever else is on screen, which is why this module listens for
// `join-request` itself rather than being opened by something that has to be
// open already. An unsupervised join never arrives here at all - that is the
// whole of what the second checkbox buys.
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

    // which flow is being answered, and the join it is about when it is one
    mode = "pair";
    joinId = "";
    isOpen = false;

    // one answer per request: the click that lands a moment after the clock ran
    // out is not a second one
    isAnswered = false;

    async mount(ctx) {
        this.info = document.getElementById("dialog-room-request-info");
        this.options = document.getElementById("room-request-options");
        this.rememberBtn = document.getElementById("btn-request-remember");
        this.rememberLabel = document.getElementById("btn-request-remember-label");
        this.unsupervisedBtn = document.getElementById("btn-request-unsupervised");
        this.unsupervisedLabel = document.getElementById("btn-request-unsupervised-label");
        this.rejectBar = document.getElementById("room-request-reject-bar");

        document.getElementById("btn-request-reject").addEventListener("click", () => {
            this.reject();
        });
        document.getElementById("btn-request-accept").addEventListener("click", () => {
            this.accept();
        });

        // letting a device in without being asked is a thing to do to a device
        // you already keep, so the second box only exists while the first is on
        this.rememberBtn.addEventListener("change", () => {
            this.applyOptions();
        });

        // a remembered device can come back at any time, so this is listened for
        // from the moment the shell is built rather than from a dialog being open
        ctx["server"].addEventListener("join-request", this.onJoinRequest);
        ctx["server"].addEventListener("join-cancel", this.onJoinCancel);
    };

    //
    // a remembered device asking for itself
    //
    onJoinRequest = (event) => {
        const detail = event.detail ?? {};
        const ctx = this.ctx;

        // one at a time: this dialog is the only place either flow is answered,
        // and a second request is refused rather than queued behind the first
        if (this.isOpen === true) {
            ctx["server"].joinReject(detail["joinId"]);
            return;
        }

        const localization = ctx["localization"];
        const record = ctx["joins"].get(detail["joinId"]);
        const name = (record?.["name"] ?? "") !== "" ? record["name"] : localization.get("new.share.join-unnamed");
        // the line carries a bold run of its own, so it reaches the document as
        // markup - the name and the address in it came from the server, so they
        // go in escaped
        const infoText = localization.putParameters(localization.get("new.share.join-info"), new Map([
            ["name", localization.escapeHTML(name)],
            ["ipAddress", localization.escapeHTML(detail["details"]?.["ipAddress"] ?? "")]
        ]));

        ctx["ui"].openDialog("room-request", {
            "mode": "join",
            "joinId": detail["joinId"],
            "info": infoText,
            "timeout": detail["timeout"] ?? ctx["conf"]["remote"]?.["pairing"]?.["answerTimeout"]
        }, true);
    };

    // it gave up, or the server ran the clock out: the dialog comes down without
    // an answer, because there is nothing left to answer
    onJoinCancel = (event) => {
        if (this.isOpen === false || this.mode !== "join" || this.joinId !== event.detail?.["joinId"]) {
            return;
        }
        this.isAnswered = true;
        this.ctx["ui"].closeDialog(this.constructor.id);
        this.finish(false);
    };

    //
    // the two answers
    //
    async accept() {
        if (this.answer() === false) {
            return;
        }
        const localization = this.ctx["localization"];
        try {
            if (this.mode === "join") {
                await this.ctx["server"].joinAccept(this.joinId);
                this.ctx["ui"].snackbar.show(localization.get("new.share.accepted"));
                this.finish(true);
                return;
            }
            const answer = await this.ctx["server"].pairAccept(this.rememberBtn.checked, this.unsupervisedBtn.checked);
            this.ctx["ui"].snackbar.show(localization.get(answer["isRemember"] === true ? "new.share.accepted-remembered" : "new.share.accepted"));
            this.finish(true, answer);
        } catch (error) {
            console.error(error);
            this.ctx["ui"].snackbar.show(localization.get("new.share.answer-failed"), true);
            this.finish(false);
        }
    };

    reject() {
        if (this.answer() === false) {
            return;
        }
        if (this.mode === "join") {
            this.ctx["server"].joinReject(this.joinId);
        } else {
            this.ctx["server"].pairReject();
        }
        this.ctx["ui"].snackbar.show(this.ctx["localization"].get(this.mode === "join" ? "new.share.rejected-join" : "new.share.rejected"));
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
    finish(isAccepted, answer) {
        this.dispatchEvent(new CustomEvent("done", {"detail": {"isAccepted": isAccepted, "answer": answer}}));
    };

    // the close button of a dialog is its reject here, and so is the clock
    requestClose() {
        this.reject();
    };

    // the checkboxes belong to the pairing: a join is made once, so a device
    // that is already remembered is only let in or not
    applyOptions() {
        const isPair = (this.mode === "pair");
        this.options.classList.toggle("hide", isPair === false);
        this.unsupervisedLabel.classList.toggle("hide", isPair === false || this.rememberBtn.checked === false);
        if (this.rememberBtn.checked === false) {
            this.unsupervisedBtn.checked = false;
        }
    };

    open(params) {
        this.info.innerHTML = params["info"];
        this.timeout = params["timeout"];
        this.mode = params["mode"] ?? "pair";
        this.joinId = params["joinId"] ?? "";
        this.isAnswered = false;
        this.isOpen = true;
        this.rememberBtn.checked = false;
        this.unsupervisedBtn.checked = false;
        this.applyOptions();

        super.open(params);

        this.startTime = Date.now();
        this.rejectBar.value = 0;
        this.updateIntervalId = setInterval(() => {
            const progress = (Date.now() - this.startTime) / this.timeout * BAR_MAX;
            this.rejectBar.value = Math.min(progress, BAR_MAX);
        }, TICK);

        this.timeoutId = setTimeout(() => {
            this.reject();
        }, Math.max(this.timeout - ANSWER_MARGIN, 0));
    };
    close() {
        clearInterval(this.updateIntervalId);
        clearTimeout(this.timeoutId);
        this.updateIntervalId = -1;
        this.timeoutId = -1;
        this.isOpen = false;
        super.close();
    };
};

export { RoomRequestDialog };
export default RoomRequestDialog;
