"use strict";

// the devices this client can connect to, paired as a guest or carried by the
// account - no joins are served today (dev/plans/ws-pairing-joins.md)

// first-party dependencies
import { Screen } from "../../../src/view.js";

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
