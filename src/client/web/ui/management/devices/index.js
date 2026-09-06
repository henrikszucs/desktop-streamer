"use strict";

// the devices this client may connect to: the joins it holds the peer side of.
// The records are local (src/joins.js) and only who is online comes from the
// server, so the list is built when somebody opens this screen and not before.

// first-party dependencies
import { Screen } from "../../../src/view.js";
import { DeviceBox } from "./device-box.js";

const DeviceScreen = class extends Screen {
    static id = "devices";
    static rootId = "screen-devices";

    async mount(ctx) {
        this.areaUser = document.getElementById("screen-devices-user");
        this.areaGuest = document.getElementById("screen-devices-guest");
        this.area = document.getElementById("devices-area");
        this.area2 = document.getElementById("devices-area-2");
    };

    async build() {
        const ctx = this.ctx;
        this.area2.innerHTML = "";

        let records = [];
        try {
            records = await ctx["joins"].list(false);
        } catch (error) {
            console.error(error);
            return;
        }

        for (const record of records) {
            const box = new DeviceBox(record["joinId"], record["joinCode"]);
            box.setName((record["name"] ?? "") !== "" ? record["name"] : ctx["localization"].get("devices.unnamed"));
            box.setOnline(record["isOnline"] === true);

            // asking to come back in is the same wait as a first pairing, so it
            // is the same dialog - which sends the request itself
            box.addEventListener("connect", function(event) {
                ctx["ui"].openDialog("room-joining", {
                    "mode": "join",
                    "joinId": event.detail["joinId"]
                });
            });
            box.addEventListener("delete", async function(event) {
                await ctx["joins"].remove(event.detail["joinId"]);
                box.el.remove();
            });
            this.area2.appendChild(box.el);
        }
    };

    open(params) {
        super.open(params);

        // clear areas
        this.area.innerHTML = "";
        this.area2.innerHTML = "";

        // there is no account either, so the area that lists its devices stays
        // out of the way
        this.areaUser.classList.add("hide");
        this.areaGuest.classList.remove("hide");

        this.build();
    };
    close() {
        this.area.innerHTML = "";
        this.area2.innerHTML = "";
        super.close();
    };
};

export { DeviceScreen };
export default DeviceScreen;
