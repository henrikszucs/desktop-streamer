"use strict";

// deleting the account, behind a key the server mails out first

// first-party dependencies
import { Panel } from "../../../../src/view.js";

const DeleteWindow = class extends Panel {
    static id = "account.delete";
    static mountPoint = "#account-windows";
    static rootId = "account-delete";

    async mount(ctx) {
        this.deleteSend = document.getElementById("btn-account-delete-send");
        this.deleteSendSuccess = document.getElementById("account-delete-send-success");
        this.deleteSendError = document.getElementById("account-delete-send-error");
        this.deleteKey = document.getElementById("account-delete-key");
        this.deleteConfirm = document.getElementById("btn-account-delete-confirm");
        this.deleteConfirmError = document.getElementById("account-delete-confirm-error");

        // no account server to mail the key out or delete against
        // (dev/plans/ws-accounts.md), so both steps only report the failure
        this.deleteSend.addEventListener("click", () => {
            this.deleteSendSuccess.classList.add("hide");
            this.deleteSendError.classList.remove("hide");
        });

        this.deleteConfirm.addEventListener("click", () => {
            this.deleteConfirmError.classList.remove("hide");
        });
    };

    open(params) {
        this.deleteSend.disabled = false;
        this.deleteSendSuccess.classList.add("hide");
        this.deleteSendError.classList.add("hide");
        this.deleteConfirmError.classList.add("hide");
        this.deleteKey.value = "";
        super.open(params);
    };
    close() {
        this.deleteKey.value = "";
        super.close();
    };
};

export { DeleteWindow };
export default DeleteWindow;
