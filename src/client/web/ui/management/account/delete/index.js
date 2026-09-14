"use strict";

// deleting the account, behind a key the server mails out first. Two halves:
// the send button asks for the key, and the key typed back is what deletes.
// The key is only good on the device that asked (src/management/account.js keeps which
// one that was), so the field and the button of the second half stay off
// until this device has asked - a key typed anywhere else would be refused
// anyway. The question before the second half is the shared confirm dialog,
// since this is the one thing in the account that cannot be taken back.

// first-party dependencies
import { Panel } from "../../../../src/view.js";

const DeleteWindow = class extends Panel {
    static id = "account.delete";
    static mountPoint = "#account-windows";
    static rootId = "account-delete";

    async mount(ctx) {
        this.deleteSend = document.getElementById("btn-account-delete-send");
        this.deleteSendProgress = document.getElementById("account-delete-send-progress");
        this.deleteSendSuccess = document.getElementById("account-delete-send-success");
        this.deleteSendWait = document.getElementById("account-delete-send-wait");
        this.deleteSendError = document.getElementById("account-delete-send-error");
        this.deleteKey = document.getElementById("account-delete-key");
        this.deleteConfirm = document.getElementById("btn-account-delete-confirm");
        this.deleteDeviceError = document.getElementById("account-delete-device-error");
        this.deleteConfirmError = document.getElementById("account-delete-confirm-error");

        this.deleteSend.addEventListener("click", () => {
            this.send();
        });
        this.deleteConfirm.addEventListener("click", () => {
            this.confirm();
        });
        this.deleteKey.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.confirm();
            }
        });
    };

    // the second half opens once this device has a key on its way
    setStage() {
        const isRequested = this.ctx["account"].hasDeleteRequest();
        this.deleteKey.disabled = (isRequested === false);
        this.deleteConfirm.disabled = (isRequested === false);
        this.deleteSendSuccess.classList.toggle("hide", isRequested === false);
    };

    hideNotices() {
        for (const notice of [this.deleteSendSuccess, this.deleteSendWait, this.deleteSendError, this.deleteDeviceError, this.deleteConfirmError]) {
            notice.classList.add("hide");
        }
    };

    // the first half: the server mails the key and this device is the one
    // that asked from now on. The mail server is a second round trip behind
    // the answer, so a bar says something is happening in the meantime.
    async send() {
        this.deleteSend.disabled = true;
        this.hideNotices();
        this.deleteSendProgress.classList.remove("hide");
        try {
            await this.ctx["account"].requestDelete();
            this.setStage();
            this.deleteKey.focus();
        } catch (error) {
            console.error("Cannot request the delete key:", error);
            const notice = (error.message === "too-soon") ? this.deleteSendWait : this.deleteSendError;
            notice.classList.remove("hide");
        }
        this.deleteSendProgress.classList.add("hide");
        this.deleteSend.disabled = false;
    };

    // the second half: only a device that asked gets as far as the question,
    // and only a yes to it reaches the server. After that the client is the
    // guest, drawn as one the way a sign out draws it.
    async confirm() {
        const ctx = this.ctx;
        this.deleteDeviceError.classList.add("hide");
        this.deleteConfirmError.classList.add("hide");

        const deleteKey = this.deleteKey.value.trim();
        if (ctx["account"].hasDeleteRequest() === false) {
            // the key ran out, or the client is another user since the field
            // was enabled
            this.setStage();
            this.deleteDeviceError.classList.remove("hide");
            return;
        }
        if (deleteKey === "") {
            this.deleteKey.focus();
            return;
        }

        const isConfirmed = await ctx["ui"].confirm({"message": "confirm.deleteAccount"});
        if (isConfirmed === false) {
            return;
        }

        this.deleteConfirm.disabled = true;
        try {
            await ctx["account"].deleteAccount(deleteKey);
        } catch (error) {
            console.error("Cannot delete the account:", error);
            this.deleteConfirmError.classList.remove("hide");
            this.deleteConfirm.disabled = false;
            return;
        }
        this.deleteConfirm.disabled = false;

        try {
            const navTop = await ctx["ui"].loadModule("nav-top");
            await navTop.refresh();
        } catch (error) {
            console.error(error);
        }
        ctx["ui"].closeDialogs();
        await ctx["ui"].reload();
        ctx["ui"].snackbar.show(ctx["localization"].get("account.delete.done"));
    };

    // the send notice and the field stand while the key is still worth typing
    open(params) {
        this.deleteSend.disabled = false;
        this.deleteSendProgress.classList.add("hide");
        this.hideNotices();
        this.deleteKey.value = "";
        this.setStage();
        super.open(params);
    };
    close() {
        this.deleteKey.value = "";
        super.close();
    };
};

export { DeleteWindow };
export default DeleteWindow;
