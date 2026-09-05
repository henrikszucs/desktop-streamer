"use strict";

// the other end of the join flow: the connection code this device hands out,
// asked of the server when the dialog opens and given back when it closes. It
// steps aside for the request dialog rather than closing - the code must live on.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

// what a failed call is called on screen. Anything else - a call that never got
// an answer among it - is the general one, since the reason it carries is a name
// for the log rather than for a user.
const ERROR_TEXTS = new Map([
    ["not-allowed", "new.share.code-denied"]
]);

// and why a request that was never answered here went away
const CANCEL_TEXTS = new Map([
    ["cancelled", "new.share.request-cancelled"],
    ["timeout", "new.share.request-timeout"]
]);

const RoomCreateDialog = class extends Dialog {
    static id = "room-create";
    static rootId = "dialog-room-create";

    // which ask owns the field. A slow answer is not a wrong answer, it is just
    // late: the dialog may have been closed and opened again since, so an answer
    // is only put on screen while it is still the one that was asked for.
    requestId = 0;

    async mount(ctx) {
        this.codeInput = document.getElementById("input-room-create-code");
        this.copyBtn = document.getElementById("btn-room-create-copy");
        this.progress = document.getElementById("progress-room-create-code");
        this.errorOutput = document.getElementById("output-room-create-error");

        this.copyBtn.addEventListener("click", () => {
            if (!navigator.clipboard) {
                this.codeInput.select();
                document.execCommand("copy");
                return;
            }
            this.codeInput.select();
            this.codeInput.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(this.codeInput.value);
        });
        document.getElementById("btn-room-create-close").addEventListener("click", () => {
            this.requestClose();
        });
    };

    //
    // the code
    //
    // ask for one and show it. A code stands as long as this dialog offers it -
    // it belongs to the socket it was asked on, and the shell closes every dialog
    // when that socket goes - so nothing here has to watch a clock.
    async createCode() {
        const requestId = ++this.requestId;
        this.displayError("");
        this.displayCode("");
        this.displayLoading(true);
        try {
            const pairCode = await this.ctx["server"].createPairCode();
            if (requestId !== this.requestId) {
                return;     // a newer ask, or a close, owns the field now
            }
            this.setCode(pairCode);
        } catch (error) {
            console.error(error);
            if (requestId !== this.requestId) {
                return;
            }
            this.displayLoading(false);

            // in the field, where the code would have been, and in the snackbar,
            // because the field is a small thing to lose an error in
            const text = this.ctx["localization"].get(ERROR_TEXTS.get(error.message) ?? "new.share.code-error");
            this.displayError(text);
            this.ctx["ui"].snackbar.show(text, true);
        }
    };

    // a code on screen, from this dialog's own call or from the server handing
    // out the one that replaces a refused number
    setCode(pairCode) {
        this.displayLoading(false);
        this.displayError("");
        this.displayCode(pairCode);
    };

    // the wait itself: the spinner stands where the code will be, for as long as
    // the answer takes, and nothing offers to copy an empty field. The input is
    // left where it is - it is what gives the field its width, and hiding it
    // shrank the dialog around the spinner.
    displayLoading(isLoading) {
        this.progress.classList.toggle("hide", isLoading === false);
        this.copyBtn.disabled = true;
    };

    // nothing to copy until there is a code, so the button follows the value
    displayCode(code) {
        this.codeInput.value = code;
        this.copyBtn.disabled = (code === "");
    };

    displayError(message) {
        const field = this.codeInput.parentElement;
        field.classList.toggle("invalid", message !== "");
        this.errorOutput.classList.toggle("hide", message === "");
        this.errorOutput.innerText = message;
    };

    //
    // somebody claimed the code
    //
    // the request dialog takes the screen over this one, which steps aside
    // rather than closing: the code, and this flow, outlive one request
    onPairRequest = async (event) => {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        const details = event.detail?.["details"] ?? {};

        const fullName = localization.get("new.share.guest");
        const infoText = localization.putParameters(localization.get("new.share.request-info"), new Map([
            ["fullName", fullName],
            ["ipAddress", details["ipAddress"] ?? ""]
        ]));

        this.hide();
        const view = await ctx["ui"].openDialog("room-request", {
            "info": infoText,
            "showRemember": false,
            "timeout": event.detail?.["timeout"] ?? ctx["conf"]["remote"]?.["pairing"]?.["answerTimeout"]
        }, true);
        view?.addEventListener("done", this.onRequestDone, {"once": true});
    };

    // the host answered it. Accepting uses the code up - the pairing it was for
    // is made - so the flow ends here; rejecting leaves the code behind, and the
    // server sends the new one that replaces it.
    onRequestDone = (event) => {
        if (event.detail?.["isAccepted"] === true) {
            this.ctx["ui"].closeDialogs();
            return;
        }
        this.show();
    };

    // the request went away without this side answering: the one waiting gave
    // up, or the server ran the clock out
    onPairCancel = (event) => {
        const reason = event.detail?.["reason"];
        this.ctx["ui"].closeDialog("room-request");
        this.show();
        this.ctx["ui"].snackbar.show(this.ctx["localization"].get(CANCEL_TEXTS.get(reason) ?? "new.share.request-cancelled"));
    };

    // the server replaced the code - a refused one is never handed out twice
    onPairCode = (event) => {
        this.setCode(event.detail?.["pairCode"] ?? "");
    };

    open(params) {
        super.open(params);
        const server = this.ctx["server"];
        server.addEventListener("pair-request", this.onPairRequest);
        server.addEventListener("pair-cancel", this.onPairCancel);
        server.addEventListener("pair-code", this.onPairCode);
        this.createCode();
    };
    close() {
        // an answer still on its way stops being this dialog's business here
        this.requestId++;

        const server = this.ctx["server"];
        server.removeEventListener("pair-request", this.onPairRequest);
        server.removeEventListener("pair-cancel", this.onPairCancel);
        server.removeEventListener("pair-code", this.onPairCode);
        this.ctx["ui"].closeDialog("room-request");

        super.close();

        this.displayLoading(false);
        this.displayCode("");
        this.displayError("");
        server.deletePairCode();
    };
};

export { RoomCreateDialog };
export default RoomCreateDialog;
