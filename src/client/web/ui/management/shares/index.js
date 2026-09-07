"use strict";

// what this client shares out: the joins it holds the host side of. The host
// answers nothing here - a device that comes back is answered by the request
// dialog wherever the shell happens to be - so this screen only lists them, says
// which are online, and lets one be forgotten for good.

// first-party dependencies
import { Screen } from "../../../src/view.js";
import { ShareBox } from "./share-box.js";

const SharesScreen = class extends Screen {
    static id = "shares";
    static rootId = "screen-shares";

    isOpen = false;

    // build() asks for the records, and asking changes them - who is online is
    // part of what comes back - so the change it makes itself is not one to
    // rebuild for
    isBuilding = false;

    async mount(ctx) {
        this.areaUser = document.getElementById("screen-shares-user");
        this.areaGuest = document.getElementById("screen-shares-guest");
        this.area = document.getElementById("shares-area");
        this.area2 = document.getElementById("shares-area-2");

        // a card is only right while what it was built from is: a device that
        // arrives or goes, a name that was changed in the dialog over this
        // screen, a connection that was deleted from it
        ctx["joins"].addEventListener("change", this.onJoinsChange);
    };

    onJoinsChange = () => {
        if (this.isOpen === false || this.isBuilding === true) {
            return;
        }
        this.build();
    };

    async build() {
        this.isBuilding = true;
        try {
            await this.buildCards();
        } finally {
            this.isBuilding = false;
        }
    };

    async buildCards() {
        const ctx = this.ctx;
        this.area2.innerHTML = "";

        let records = [];
        try {
            records = await ctx["joins"].list(true);
        } catch (error) {
            console.error(error);
            return;
        }

        const localization = ctx["localization"];
        for (const record of records) {
            const box = new ShareBox(record["joinId"], record["joinCode"]);

            // a card is built long after this module was translated, so it is
            // handed over on its own - the labels in it are markup like any other
            localization.translate(localization.getLang(), box.el);
            box.setName((record["name"] ?? "") !== "" ? record["name"] : localization.get("shares.unnamed"));
            box.setTag("online", record["isOnline"] === true);
            box.setTag("offline", record["isOnline"] !== true);

            // a device that may come and go without anybody being asked is worth
            // saying so on the card, since nothing else will ever mention it
            box.setUnattended(record["isUnsupervised"] === true);

            box.addEventListener("delete", async function(event) {
                await ctx["joins"].remove(event.detail["joinId"]);
                box.el.remove();
            });

            // the name and the delete of one connection, in one place. The grid
            // follows what it did through the change above rather than being
            // told twice.
            box.addEventListener("settings", function(event) {
                ctx["ui"].openDialog("connection", {"joinId": event.detail["joinId"]});
            });
            this.area2.appendChild(box.el);
        }
    };

    open(params) {
        this.area.innerHTML = "";
        this.area2.innerHTML = "";
        this.isOpen = true;

        super.open(params);

        // there is no account either, so the area that lists its shares stays
        // out of the way
        this.areaUser.classList.add("hide");
        this.areaGuest.classList.remove("hide");

        this.build();
    };
    close() {
        this.isOpen = false;
        this.area.innerHTML = "";
        this.area2.innerHTML = "";
        super.close();
    };
};

export { SharesScreen };
export default SharesScreen;
