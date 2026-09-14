"use strict";

// the question the room asks before it lets go of one. It decides nothing: it
// dispatches `done` with the answer and the room screen acts on it, the same
// way the request dialog hands its answer back to the one that opened it.
//
// Saying nothing is staying, so every way out of this dialog that is not the
// confirm button - the close button, the cancel, a click on the overlay - is a
// no, and it is answered exactly once per opening.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const RoomExitDialog = class extends Dialog {
    static id = "room-exit";
    static rootId = "dialog-room-exit";

    isAnswered = false;

    async mount(ctx) {
        document.getElementById("btn-room-exit-close").addEventListener("click", () => {
            this.requestClose();
        });
        document.getElementById("btn-room-exit-cancel").addEventListener("click", () => {
            this.requestClose();
        });
        document.getElementById("btn-room-exit-confirm").addEventListener("click", () => {
            this.answer(true);
        });
    };

    // one answer per opening: the dialog goes first, and what it decided is
    // dispatched after it, so the screen that leaves is not leaving under it
    answer(isConfirmed) {
        if (this.isAnswered === true) {
            return;
        }
        this.isAnswered = true;
        this.ctx["ui"].closeDialog(this.constructor.id);
        this.dispatchEvent(new CustomEvent("done", {"detail": {"isConfirmed": isConfirmed === true}}));
    };

    open(params) {
        this.isAnswered = false;
        super.open(params);
    };

    // the close is also how the flow ends from somewhere else - a navigation, a
    // connection that dropped - and an unanswered question is a no
    close() {
        super.close();
        this.answer(false);
    };
};

export { RoomExitDialog };
export default RoomExitDialog;
