"use strict";

// the devices this client can connect to: the ones paired as a guest, kept in
// the local database, and the ones the account carries
//
// Both lists were built from the joins the server keeps and followed its join
// events while the screen was open. Nothing carries joins today
// (dev/plans/ws-pairing-joins.md), so the screen opens on two empty areas and
// ./device-box.js waits there for them.

// first-party dependencies
import { Screen } from "../../src/view.js";

const DeviceScreen = class extends Screen {
    static id = "devices";
    static rootId = "screen-devices";

    async mount(ctx) {
        this.areaUser = document.getElementById("screen-devices-user");
        this.areaGuest = document.getElementById("screen-devices-guest");
        this.area = document.getElementById("devices-area");
        this.area2 = document.getElementById("devices-area-2");
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
    };
    close() {
        this.area.innerHTML = "";
        this.area2.innerHTML = "";
        super.close();
    };
};

export { DeviceScreen };
export default DeviceScreen;
