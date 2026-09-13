"use strict";

// the devices this client may connect to: the joins it holds the peer side of,
// for the user it is right now. The records are the user's (src/joins.js) -
// the guest's are its codes, an account's follow it to every client it signs
// in on - and only who is online comes from the server, so the list is built
// when somebody opens this screen and kept right while it is open.
//
// Every card carries the same menu as a share: settings, which is the one
// dialog a connection is named and forgotten in (management/connection), and
// delete, which asks first because it goes on both sides for good.

// first-party dependencies
import { Screen } from "../../../src/view.js";
import { DeviceBox } from "./device-box.js";

const DeviceScreen = class extends Screen {
    static id = "devices";
    static rootId = "screen-devices";

    isOpen = false;

    // a change that arrives while the grid is being built is not dropped: the
    // build runs again when it is done, since what it drew may already be
    // behind - the codes presented after an account switch are the usual case
    isBuilding = false;
    isPending = false;

    async mount(ctx) {
        this.area = document.getElementById("devices-area");

        // a card is only right while what it was built from is: a device that
        // arrives or goes, a name that was changed in the dialog over this
        // screen, a connection that was deleted from it, a user that switched
        ctx["joins"].addEventListener("change", this.onJoinsChange);
    };

    onJoinsChange = () => {
        if (this.isOpen === false) {
            return;
        }
        this.build();
    };

    async build() {
        if (this.isBuilding === true) {
            this.isPending = true;
            return;
        }
        this.isBuilding = true;
        try {
            do {
                this.isPending = false;
                await this.buildCards();
            } while (this.isPending === true && this.isOpen === true);
        } finally {
            this.isBuilding = false;
            this.isPending = false;
        }
    };

    async buildCards() {
        const ctx = this.ctx;

        let records = [];
        try {
            records = await ctx["joins"].list(false);
        } catch (error) {
            console.error(error);
            return;
        }

        // and only now: the grid emptied before the answer arrives is a screen
        // that blinks on every rebuild, and one that stays empty when the call
        // fails
        this.area.innerHTML = "";

        const localization = ctx["localization"];
        for (const record of records) {
            const box = new DeviceBox(record["joinId"], record["joinCode"]);

            // a card is built long after this module was translated, so it is
            // handed over on its own - the labels in it are markup like any other
            localization.translate(localization.getLang(), box.el);
            box.setName((record["name"] ?? "") !== "" ? record["name"] : localization.get("devices.unnamed"));
            box.setOnline(record["isOnline"] === true);

            // asking to come back in is the same wait as a first pairing, so it
            // is the same dialog - which sends the request itself
            box.addEventListener("connect", function(event) {
                ctx["ui"].openDialog("room-joining", {
                    "mode": "join",
                    "joinId": event.detail["joinId"]
                });
            });

            // the name and the delete of one connection, in one place. The grid
            // follows what it did through the change above rather than being
            // told twice.
            box.addEventListener("settings", function(event) {
                ctx["ui"].openDialog("connection", {"joinId": event.detail["joinId"]});
            });

            // forgetting one goes both ways and cannot be undone, so it is
            // asked about first - see confirm() in ui/ui.js
            box.addEventListener("delete", async function(event) {
                const isConfirmed = await ctx["ui"].confirm({"message": "confirm.deleteJoin"});
                if (isConfirmed === false) {
                    return;
                }
                try {
                    await ctx["joins"].remove(event.detail["joinId"]);
                } catch (error) {
                    console.error(error);
                }
                box.el.remove();
            });
            this.area.appendChild(box.el);
        }
    };

    open(params) {
        this.area.innerHTML = "";
        this.isOpen = true;
        super.open(params);
        this.build();
    };
    close() {
        this.isOpen = false;
        this.area.innerHTML = "";
        super.close();
    };
};

export { DeviceScreen };
export default DeviceScreen;
