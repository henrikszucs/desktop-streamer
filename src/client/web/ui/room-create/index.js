"use strict";

// the other end of the join flow: this device asks the server for a pair code,
// shows it, and waits. When someone claims the code the request dialog comes up
// over this one, so this dialog steps aside instead of closing - the pair code
// has to stay alive until the flow ends.
//
// The pair code and the request that claims it went with the pairing server
// (dev/plans/ws-pairing-joins.md), so the dialog opens on an empty field and
// nobody arrives on it. What is left here is its own half: the field, the copy
// button and the close button.

// first-party dependencies
import { Dialog } from "../../src/view.js";

const RoomCreateDialog = class extends Dialog {
    static id = "room-create";
    static rootId = "dialog-room-create";

    async mount(ctx) {
        this.codeInput = document.getElementById("input-room-create-code");
        this.copyBtn = document.getElementById("btn-room-create-copy");

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

    open(params) {
        super.open(params);
        this.codeInput.value = "";
    };
    close() {
        this.ctx["ui"].closeDialog("room-request");

        super.close();

        this.codeInput.value = "";
    };
};

export { RoomCreateDialog };
export default RoomCreateDialog;
