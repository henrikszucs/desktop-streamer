"use strict";

// the address and the names behind the account. The address is Google's to
// say and cannot be changed here; the names are the user's, written on the
// server and shown in the bar from then on.

// first-party dependencies
import { Panel } from "../../../../src/view.js";

const InformationWindow = class extends Panel {
    static id = "account.information";
    static mountPoint = "#account-windows";
    static rootId = "account-information";

    async mount(ctx) {
        this.email = document.getElementById("account-email");
        this.firstName = document.getElementById("account-firstname");
        this.lastName = document.getElementById("account-lastname");
        this.saveBtn = document.getElementById("btn-account-information-save");

        this.saveBtn.addEventListener("click", () => {
            this.save();
        });
        for (const input of [this.firstName, this.lastName]) {
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    this.save();
                }
            });
        }

        // a change made on another device lands here too, while it is open
        ctx["account"].addEventListener("change", () => {
            if (this.el.classList.contains("hide") === false && this.isSaving === false) {
                this.fill();
            }
        });
    };

    fill() {
        const record = this.ctx["account"].current();
        this.email.value = record?.["email"] ?? "";
        this.firstName.value = record?.["firstName"] ?? "";
        this.lastName.value = record?.["lastName"] ?? "";
    };

    async save() {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        if (this.isSaving === true) {
            return;
        }
        this.isSaving = true;
        this.saveBtn.disabled = true;
        try {
            await ctx["account"].update(this.firstName.value.trim(), this.lastName.value.trim());
            ctx["ui"].snackbar.show(localization.get("account.information.saved"));
        } catch (error) {
            console.error(error);
            ctx["ui"].snackbar.show(localization.get("account.information.failed"), true);
        }
        this.saveBtn.disabled = false;
        this.isSaving = false;
        this.fill();
    };

    open(params) {
        super.open(params);
        this.isSaving = false;
        this.fill();
    };
    close() {
        super.close();
        this.email.value = "";
        this.firstName.value = "";
        this.lastName.value = "";
    };
};

export { InformationWindow };
export default InformationWindow;
