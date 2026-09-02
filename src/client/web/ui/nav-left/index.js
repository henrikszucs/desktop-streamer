"use strict";

// the left rail of the management segment: the entries the bars lead to, wide
// or narrow
//
// It is chrome rather than a screen, so the router puts it on and off the screen
// by its data-segment attribute and never opens or closes it. What it owns is
// its own width - which the shares badge has to be re-parented for - and the two
// entries that are not there for every client.

// first-party dependencies
import { View } from "../../src/view.js";

const NavLeft = class extends View {
    static id = "nav-left";
    static mountPoint = "body";
    static rootId = "nav-left";

    isMax = false;
    menuBtn = null;
    btnDownload = null;
    btnShares = null;
    btnServices = null;

    async mount(ctx) {
        this.menuBtn = document.getElementById("btn-menu-left");
        this.btnDownload = document.getElementById("btn-download");
        this.btnShares = document.getElementById("btn-shares");
        this.btnServices = document.getElementById("btn-services");

        // the rail opens wide on a window with the room for it, and stays as the
        // markup has it on one too small to carry the rail at all
        const env = ctx["ui"].env;
        if (env["sizeS"] < env["width"]) {
            this.isMax = (env["width"] >= env["sizeM"]);
            this.switchMenu();
        }
        this.menuBtn.addEventListener("click", () => {
            this.isMax = !this.isMax;
            this.switchMenu();
        });

        // the menu dialog is this rail for a window too small to show it - once
        // the window is wide enough for the rail itself, the dialog is redundant
        window.addEventListener("resize", () => {
            if (env["sizeS"] < window.innerWidth && ctx["router"].isDialogOpen("menu") === true) {
                ctx["router"].closeDialog("menu");
            }
        });

        // the desktop client is already the download
        if (ctx["desktop"].isAvailable) {
            this.btnDownload.classList.add("hide");
        }

        ctx["server"].addEventListener("online", this.onOnline);
        this.onOnline();
    };

    // services are a server feature, so the entry is only there once the
    // configuration has arrived and carries them
    onOnline = () => {
        const hasServices = typeof this.ctx["conf"]["remote"]?.["serviceSharing"] !== "undefined";
        if (hasServices) {
            this.btnServices.classList.remove("hide");
        } else {
            this.btnServices.classList.add("hide");
        }
    };

    // wide, labels beside the icons, or narrow
    //
    // beercss reads the badge of a nav entry as nav.left > a > .badge, so the
    // narrow rail wants it as a direct child of the entry and the wide one wants
    // it inside the wrapper beside the icon. The badge moves with the width.
    switchMenu() {
        if (this.isMax) {
            this.el.classList.add("max");
            this.btnDownload.classList.add("primary");
            this.btnDownload.children[0].classList.remove("primary");

            if (this.btnShares.children.item(0).tagName !== "DIV") {
                const icon = this.btnShares.children.item(0);
                const badge = this.btnShares.children.item(1);
                const div = document.createElement("div");
                div.prepend(badge);
                div.prepend(icon);
                this.btnShares.prepend(div);
            }
        } else {
            this.el.classList.remove("max");
            this.btnDownload.classList.remove("primary");
            this.btnDownload.children[0].classList.add("primary");

            if (this.btnShares.children.item(0).tagName === "DIV") {
                const div = this.btnShares.children.item(0);
                const icon = div.children.item(0);
                const badge = div.children.item(1);
                div.remove();
                this.btnShares.prepend(badge);
                this.btnShares.prepend(icon);
            }
        }
    };
};

export { NavLeft };
export default NavLeft;
