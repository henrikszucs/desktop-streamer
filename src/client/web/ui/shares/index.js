"use strict";

// what this client shares out: the guest shares kept in the local database, and
// the ones the account carries
//
// Both lists were built from the joins the server keeps. Nothing carries joins
// today (dev/plans/ws-pairing-joins.md), so the screen opens on two empty areas
// and ./share-box.js waits there for them.

// first-party dependencies
import { Screen } from "../../src/view.js";

const SharesScreen = class extends Screen {
    static id = "shares";
    static rootId = "screen-shares";

    async mount(ctx) {
        this.areaUser = document.getElementById("screen-shares-user");
        this.areaGuest = document.getElementById("screen-shares-guest");
        this.area = document.getElementById("shares-area");
        this.area2 = document.getElementById("shares-area-2");
    };

    open(params) {
        this.area.innerHTML = "";
        this.area2.innerHTML = "";

        super.open(params);

        // there is no account either, so the area that lists its shares stays
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

export { SharesScreen };
export default SharesScreen;
