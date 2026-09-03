"use strict";

// the side menu of the small layout: the same entries the left navigation bar
// carries, as a dialog. The entries are [data-route] like every other one, the
// router closes the dialog when it switches screen.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const MenuDialog = class extends Dialog {
    static id = "menu";
    static rootId = "dialog-menu";

    services = null;

    async mount(ctx) {
        this.services = document.getElementById("btn-services-2");
        document.getElementById("btn-menu-close").addEventListener("click", () => {
            this.requestClose();
        });

        // the shares badge follows the joins, which the server does not carry
        // today (dev/plans/ws-pairing-joins.md) - the markup starts it hidden

        // the same two entries the shell hides for itself
        ctx["server"].addEventListener("online", this.onOnline);
        this.onOnline();
        if (ctx["desktop"].isAvailable) {
            document.getElementById("btn-download-2").classList.add("hide");
        }
    };

    onOnline = () => {
        const hasServices = typeof this.ctx["conf"]["remote"]?.["serviceSharing"] !== "undefined";
        if (hasServices) {
            this.services.classList.remove("hide");
        } else {
            this.services.classList.add("hide");
        }
    };
};

export { MenuDialog };
export default MenuDialog;
