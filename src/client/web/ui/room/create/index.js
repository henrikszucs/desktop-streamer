"use strict";

// the other end of the join flow: a pair code, shown while this device waits. It
// steps aside for the request dialog rather than closing - the code must live on.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

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
