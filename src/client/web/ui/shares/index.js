"use strict";

// what this client shares out: the guest shares kept in the local database, and
// the ones the account carries

// first-party dependencies
import { Screen } from "../../src/view.js";
import ShareBox from "./share-box.js";

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
        const server = this.ctx["server"];
        this.area.innerHTML = "";
        this.area2.innerHTML = "";

        super.open(params);

        // get local shares
        if (server.joinsGuest.size === 0) {
            if (server.loginState["isLoggedIn"] === true) {
                this.areaGuest.classList.add("hide");
            }
        } else {
            this.areaGuest.classList.remove("hide");
            for (const join of server.joinsGuest) {
                // get data from server
                const joinId = join[0];
                const hostCode = join[1]["hostCode"];
                if (hostCode === undefined) {
                    continue;
                }
                const deviceEl = new ShareBox(joinId, hostCode);
                const name = join[1]["name"];
                const isOnline = join[1]["isOnline"];
                const isRemember = join[1]["isRemember"];
                deviceEl.setName(name);
                deviceEl.setTag("local", true);
                deviceEl.setTag("temporary", isRemember === false);
                deviceEl.setTag("online", isOnline);
                this.area2.appendChild(deviceEl.el);
            }
        }

        // get user shares
        if (server.loginState["isLoggedIn"] === false) {
            this.areaUser.classList.add("hide");
        } else {
            this.areaUser.classList.remove("hide");
            for (const join of server.joinsUser) {
                const joinId = join[0];
                if (join[1]["isHost"] !== true) {
                    continue;
                }
                const hostCode = join[1]["hostCode"];
                const name = join[1]["name"];
                const isOnline = join[1]["isOnline"];
                const isRemember = join[1]["isRemember"];

                const deviceEl = new ShareBox(joinId, hostCode);
                deviceEl.setName(name);
                deviceEl.setTag("online", isOnline);
                deviceEl.setTag("offline", isOnline === false);
                deviceEl.setTag("temporary", isRemember === false);
                if (hostCode !== undefined) {
                    deviceEl.setTag("local", true);
                } else {
                    deviceEl.setTag("local", false);
                }
                this.area.appendChild(deviceEl.el);
            }
        }
    };
    close() {
        this.area.innerHTML = "";
        this.area2.innerHTML = "";
        super.close();
    };
};

export { SharesScreen };
export default SharesScreen;
