"use strict";

// the side menu of the small layout: the same entries the left navigation bar
// carries, as a dialog. The entries are [data-route] like every other one, the
// router closes the dialog when it switches screen.

// first-party dependencies
import { Dialog } from "../../src/view.js";

const MenuDialog = class extends Dialog {
    static id = "menu";
    static rootId = "dialog-menu";

    badge = null;
    services = null;

    async mount(ctx) {
        this.badge = document.getElementById("badge-shares-2");
        this.services = document.getElementById("btn-services-2");
        document.getElementById("btn-menu-close").addEventListener("click", () => {
            this.requestClose();
        });

        ctx["server"].addEventListener("share-start", this.onShareStart);
        ctx["server"].addEventListener("share-end", this.onShareEnd);
        this.setBadge(ctx["server"].isShare());

        // the same two entries the shell hides for itself
        ctx["server"].addEventListener("online", this.onOnline);
        this.onOnline();
        if (ctx["desktop"].isAvailable) {
            document.getElementById("btn-download-2").classList.add("hide");
        }
    };

    onOnline = () => {
        const hasServices = typeof this.ctx["conf"]["ws"]["remote"]?.["serviceSharing"] !== "undefined";
        if (hasServices) {
            this.services.classList.remove("hide");
        } else {
            this.services.classList.add("hide");
        }
    };

    onShareStart = () => {
        this.setBadge(true);
    };
    onShareEnd = () => {
        this.setBadge(false);
    };
    setBadge(isSharing) {
        if (isSharing === true) {
            this.badge.classList.remove("hide");
        } else {
            this.badge.classList.add("hide");
        }
    };
};

export { MenuDialog };
export default MenuDialog;
