"use strict";

// what the guest can say about itself: a name, on its own row in the local
// database. There is no account behind the guest, so nothing here reaches the
// server - the bar's user menu is what reads it back.
//
// The field opens on the name the bar shows - the one on the row, or the
// localized "Guest" when there is none - so what is edited is what is seen.
// Saving that default back, or nothing, keeps the row empty rather than
// writing the word in, so the name goes on following the language.

// first-party dependencies
import { Panel } from "../../../../src/view.js";
import { GUEST_ID } from "../../../../src/conf.js";

const GuestWindow = class extends Panel {
    static id = "account.guest";
    static mountPoint = "#account-windows";
    static rootId = "account-guest";

    async mount(ctx) {
        this.nameInput = document.getElementById("account-guest-name");
        this.saveBtn = document.getElementById("btn-account-guest-save");

        this.saveBtn.addEventListener("click", () => {
            this.save();
        });
        this.nameInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.save();
            }
        });
    };

    // the localized default, the name of a guest that gave itself none
    defaultName() {
        return this.ctx["localization"].get("main.guest");
    };

    // the row keeps the joins beside the name, so it is read and written whole
    async save() {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        try {
            const user = await ctx["getUser"](GUEST_ID);
            const name = this.nameInput.value.trim();
            user["name"] = (name === this.defaultName() ? "" : name);
            await ctx["setUser"](GUEST_ID, user);
            const navTop = await ctx["ui"].loadModule("nav-top");
            await navTop.refresh();
            ctx["ui"].snackbar.show(localization.get("account.guest.saved"));
        } catch (error) {
            console.error(error);
            ctx["ui"].snackbar.show(localization.get("account.guest.failed"), true);
        }
    };

    open(params) {
        super.open(params);
        this.nameInput.value = "";
        this.ctx["getUser"](GUEST_ID).then((user) => {
            if (this.el.classList.contains("hide") === true) {
                return;
            }
            const name = typeof user["name"] === "string" ? user["name"].trim() : "";
            this.nameInput.value = (name !== "" ? name : this.defaultName());
        });
    };
    close() {
        super.close();
        this.nameInput.value = "";
    };
};

export { GuestWindow };
export default GuestWindow;
