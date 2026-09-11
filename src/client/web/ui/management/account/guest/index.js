"use strict";

// what the guest can say about itself: a name, on its own row in the local
// database. There is no account behind the guest, so nothing here reaches the
// server - the bar's user menu is what reads it back.

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

    // the row keeps the joins beside the name, so it is read and written whole
    async save() {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        try {
            const user = await ctx["getUser"](GUEST_ID);
            user["name"] = this.nameInput.value.trim();
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
            if (this.el.classList.contains("hide") === false) {
                this.nameInput.value = typeof user["name"] === "string" ? user["name"] : "";
            }
        });
    };
    close() {
        super.close();
        this.nameInput.value = "";
    };
};

export { GuestWindow };
export default GuestWindow;
