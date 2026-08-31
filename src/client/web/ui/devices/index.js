"use strict";

// the devices this client can connect to: the ones paired as a guest, kept in
// the local database, and the ones the account carries. It follows the join
// events of the server while it is open, and lets go of them when it is not.

// first-party dependencies
import { Screen } from "../../src/view.js";
import DeviceBox from "./device-box.js";

const DeviceScreen = class extends Screen {
    static id = "devices";
    static rootId = "screen-devices";

    boxes = new Map();

    async mount(ctx) {
        this.areaUser = document.getElementById("screen-devices-user");
        this.areaGuest = document.getElementById("screen-devices-guest");
        this.area = document.getElementById("devices-area");
        this.area2 = document.getElementById("devices-area-2");
    };

    addDeviceBox(isGuest, joinId, peerCode, name, isOnline) {
        const deviceBox = new DeviceBox(joinId, peerCode);
        console.log("Add device box:", joinId, peerCode, name, isOnline);
        deviceBox.setName(name);
        deviceBox.setOnline(isOnline);
        if (isGuest) {
            this.area2.appendChild(deviceBox.el);
        } else {
            this.area.appendChild(deviceBox.el);
        }
        this.boxes.set(joinId, deviceBox);
    };
    changeDeviceBox(joinId, options) {
        const deviceBox = this.boxes.get(joinId);
        if (deviceBox === undefined) {
            return;
        }
        if (options["name"] !== undefined) {
            deviceBox.setName(options["name"]);
        }
        if (options["isOnline"] !== undefined) {
            deviceBox.setOnline(options["isOnline"]);
        }
    };
    removeDeviceBox(joinId) {
        const deviceBox = this.boxes.get(joinId);
        if (deviceBox === undefined) {
            return;
        }
        deviceBox.el.remove();
        this.boxes.delete(joinId);
    };
    onJoinAdd = (event) => {
        const joinId = event.detail.joinId;
        const value = event.detail.value;
        if (value["isGuest"] && value["peerCode"] === undefined) {
            return;
        }
        const peerCode = value["peerCode"];
        const name = value["name"];
        const isOnline = value["isOnline"];
        this.addDeviceBox(value["isGuest"], joinId, peerCode, name, isOnline);
    };
    onJoinChanged = (event) => {
        console.log(event)
        const joinId = event.detail.joinId;
        const value = event.detail.value;
        if (value["isGuest"] && value["peerCode"] === undefined) {
            return;
        }
        this.changeDeviceBox(joinId, {
            "name": value["name"],
            "isOnline": value["isOnline"]
        });
    };
    onJoinDelete = (event) => {
        const joinId = event.detail.joinId;
        this.removeDeviceBox(joinId);
    };

    open(params) {
        const server = this.ctx["server"];
        super.open(params);

        // clear areas
        this.area.innerHTML = "";
        this.area2.innerHTML = "";

        // get local devices
        if (server.joinsGuest.size === 0) {
            if (server.loginState["isLoggedIn"] === true) {
                this.areaGuest.classList.add("hide");
            }
        } else {
            this.areaGuest.classList.remove("hide");
            for (const join of server.joinsGuest) {
                // get data from server
                const joinId = join[0];
                const peerCode = join[1]["peerCode"];
                if (peerCode === undefined) {
                    continue;
                }
                const name = join[1]["name"];
                const isOnline = join[1]["isOnline"];
                this.addDeviceBox(true, joinId, peerCode, name, isOnline);
            }
        }

        // get user devices
        if (server.loginState["isLoggedIn"] === false) {
            this.areaUser.classList.add("hide");
        } else {
            for (const join of server.joinsUser) {
                const joinId = join[0];
                const isPeer = join[1]["isPeer"];
                if (isPeer !== true) {
                    continue;
                }
                const name = join[1]["name"];
                const isOnline = join[1]["isOnline"];
                this.addDeviceBox(false, joinId, undefined, name, isOnline);
            }
        }

        server.addEventListener("join-added", this.onJoinAdd);
        server.addEventListener("join-changed", this.onJoinChanged);
        server.addEventListener("join-removed", this.onJoinDelete);
    };
    close() {
        const server = this.ctx["server"];
        this.area.innerHTML = "";
        this.area2.innerHTML = "";
        this.boxes.clear();
        super.close();

        server.removeEventListener("join-added", this.onJoinAdd);
        server.removeEventListener("join-changed", this.onJoinChanged);
        server.removeEventListener("join-removed", this.onJoinDelete);
    };
};

export { DeviceScreen };
export default DeviceScreen;
