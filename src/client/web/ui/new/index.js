"use strict";

// the default screen: join a room with a code, or share this device
//
// it owns both flows, so the dialogs of a flow are opened from here and the
// result comes back to the field that started it. The share flow hands over to
// room-create, which carries it from there.

// first-party dependencies
import { Screen } from "../../src/view.js";

const NewScreen = class extends Screen {
    static id = "new";
    static rootId = "screen-new";

    async mount(ctx) {
        // get important elements
        this.joinCode = document.getElementById("input-new-code");
        this.joinBtn = document.getElementById("btn-new-join");
        this.createBtn = document.getElementById("btn-new-create");

        // set event listeners
        this.joinBtn.addEventListener("click", () => {
            this.join(this.joinCode.value.trim());
        });
        this.createBtn.addEventListener("click", () => {
            ctx["ui"].openDialog("room-create", {});
        });
    };

    open(params) {
        this.joinCode.value = "";
        this.displayJoinError("");
        super.open(params);
    };
    close() {
        this.joinCode.value = "";
        this.displayJoinError("");
        super.close();
    };

    displayJoinError(message) {
        const field = this.joinCode.parentElement;
        if (message === "") {
            field.classList.remove("invalid");
            field.children.item(2).classList.add("hide");
            return;
        }
        field.classList.add("invalid");
        field.children.item(2).classList.remove("hide");
        field.children.item(2).innerText = message;
    };

    // ask the host behind a join code to let this device in, then wait for the
    // answer in the joining dialog
    async join(code) {
        const ctx = this.ctx;
        const server = ctx["server"];
        const localization = ctx["localization"];

        this.displayJoinError("");
        const res = await server.pairRequest(code);
        if (res["success"] !== true) {
            this.displayJoinError(localization.get("new.join.code-invalid"));
            return;
        }

        let fullName = "";
        if (res["details"]["isUser"]) {
            const loc = localization.get("new.join.full-name");
            fullName = localization.putParameters(loc, new Map([
                ["firstName", res["details"]["firstName"]],
                ["lastName", res["details"]["lastName"]]
            ]));
        } else {
            fullName = localization.get("new.join.guest");
        }
        let infoText = localization.get("new.join.dialog-info");
        infoText = localization.putParameters(infoText, new Map([
            ["fullName", fullName],
            ["ipAddress", res["details"]["ipAddress"]]
        ]));

        const dialog = await ctx["ui"].openDialog("room-joining", {
            "info": infoText,
            "timeout": res["timeout"]
        });

        // giving up is not a rejection, the host never answered
        let wasCancelled = false;
        const cancelHandler = function() {
            wasCancelled = true;
        };
        const forget = function() {
            dialog.removeEventListener("cancel", cancelHandler);
            server.removeEventListener("pair-accept", pairAcceptHandler);
            server.removeEventListener("pair-reject", pairRejectHandler);
            server.removeEventListener("offline", offlineHandler);
        };
        const pairAcceptHandler = (event) => {
            console.log(event.detail);
            forget();
            ctx["ui"].closeDialogs();
            // todo: open room screen
        };
        const pairRejectHandler = () => {
            forget();
            if (wasCancelled === false) {
                this.displayJoinError(localization.get("new.join.code-rejected"));
            }
            ctx["ui"].closeDialogs();
        };
        const offlineHandler = () => {
            forget();
        };
        dialog.addEventListener("cancel", cancelHandler);
        server.addEventListener("pair-accept", pairAcceptHandler);
        server.addEventListener("pair-reject", pairRejectHandler);
        server.addEventListener("offline", offlineHandler);
    };
};

export { NewScreen };
export default NewScreen;
