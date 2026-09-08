"use strict";

// the question the shell asks before something is undone for good. It decides
// nothing: it dispatches `done` with the answer and whoever opened it acts on
// it, the way the room's exit dialog does.
//
// Saying nothing is saying no, so every way out that is not the accept button -
// the close, the cancel, a click on the overlay, the dialog being torn down by a
// navigation - is a no, answered exactly once per opening.
//
// What is being undone reaches it as **localization keys** rather than as text:
// a language switched while this is open re-translates the document from those
// attributes, and a line put here as text would go back to whatever the markup
// was built with.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

// what the accept button says when the caller does not name something else
const DEFAULT_CONFIRM = "confirm.delete";

const ConfirmDialog = class extends Dialog {
    static id = "confirm";
    static rootId = "dialog-confirm";

    isAnswered = false;

    async mount(ctx) {
        this.message = document.getElementById("dialog-confirm-message");
        this.acceptLabel = document.getElementById("btn-confirm-accept-label");

        document.getElementById("btn-confirm-close").addEventListener("click", () => {
            this.requestClose();
        });
        document.getElementById("btn-confirm-cancel").addEventListener("click", () => {
            this.requestClose();
        });
        document.getElementById("btn-confirm-accept").addEventListener("click", () => {
            this.answer(true);
        });
    };

    // one answer per opening: the dialog goes first, and what it decided is
    // dispatched after it, so what acts on the yes is not acting under it
    answer(isConfirmed) {
        if (this.isAnswered === true) {
            return;
        }
        this.isAnswered = true;
        this.ctx["ui"].closeDialog(this.constructor.id);
        this.dispatchEvent(new CustomEvent("done", {"detail": {"isConfirmed": isConfirmed === true}}));
    };

    // the key is set on the element as well as read from it, so a language
    // switch while this is open redraws the line it is actually asking
    setText(el, key) {
        el.setAttribute("data-localization", key);
        el.innerText = this.ctx["localization"].get(key);
    };

    open(params) {
        this.isAnswered = false;
        this.setText(this.message, params?.["message"] ?? "");
        this.setText(this.acceptLabel, params?.["confirm"] ?? DEFAULT_CONFIRM);
        super.open(params);
    };

    // closing is also how the question ends from somewhere else - a navigation,
    // a connection that dropped - and an unanswered question is a no
    close() {
        super.close();
        this.answer(false);
    };
};

export { ConfirmDialog, DEFAULT_CONFIRM };
export default ConfirmDialog;
