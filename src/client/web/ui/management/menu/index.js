"use strict";

// the side menu of the small layout: the left rail's entries as a dialog, all
// [data-route], so the router closes it when it switches screen

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const MenuDialog = class extends Dialog {
    static id = "menu";
    static rootId = "dialog-menu";

    services = null;
    badgeShares = null;

    async mount(ctx) {
        this.services = document.getElementById("btn-services-2");
        this.badgeShares = document.getElementById("badge-shares-2");
        document.getElementById("btn-menu-close").addEventListener("click", () => {
            this.requestClose();
        });

        // the same dot the rail carries, on the entry that is this rail for a
        // window too small to show it - see nav-left
        ctx["joins"].addEventListener("change", this.onJoinsChange);

        // the room is the other half of that dot, so its two edges draw it too
        ctx["room"].addEventListener("connecting", this.onJoinsChange);
        ctx["room"].addEventListener("closed", this.onJoinsChange);
        this.onJoinsChange();

        // the same two entries the shell hides for itself
        ctx["server"].addEventListener("online", this.onOnline);
        this.onOnline();
        if (ctx["desktop"].isAvailable) {
            document.getElementById("btn-download-2").classList.add("hide");
        }
    };

    onJoinsChange = () => {
        const isShared = (this.ctx["joins"].countOnline(true) > 0 || this.ctx["room"].isSharing() === true);
        this.badgeShares.classList.toggle("hide", isShared === false);
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
