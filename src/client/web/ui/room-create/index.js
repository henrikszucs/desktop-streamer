"use strict";

// the other end of the join flow: this device asks the server for a pair code,
// shows it, and waits. When someone claims the code the request dialog comes up
// over this one, so this dialog steps aside instead of closing - the pair code
// has to stay alive until the flow ends.

// first-party dependencies
import { Dialog } from "../../src/view.js";

const RoomCreateDialog = class extends Dialog {
    static id = "room-create";
    static rootId = "dialog-room-create";

    async mount(ctx) {
        this.codeInput = document.getElementById("input-room-create-code");
        this.copyBtn = document.getElementById("btn-room-create-copy");

        this.copyBtn.addEventListener("click", () => {
            if (!navigator.clipboard) {
                this.codeInput.select();
                document.execCommand("copy");
                return;
            }
            this.codeInput.select();
            this.codeInput.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(this.codeInput.value);
        });
        document.getElementById("btn-room-create-close").addEventListener("click", () => {
            this.requestClose();
        });
    };

    async createJoin() {
        const code = await this.ctx["server"].createPairCode();
        this.codeInput.value = code;
    };

    open(params) {
        super.open(params);
        this.ctx["server"].addEventListener("pair-request", this.onPairRequest);
        this.createJoin();
    };
    close() {
        const server = this.ctx["server"];
        server.removeEventListener("pair-request", this.onPairRequest);
        this.forgetRequest();
        this.ctx["ui"].closeDialog("room-request");

        super.close();

        this.codeInput.value = "";
        server.deletePairCode();
    };

    //
    // someone claimed the code
    //
    onPairRequest = async (event) => {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        const detail = event.detail;
        console.log("Paired to room:", detail);

        let fullName = "";
        if (detail["details"]["isUser"]) {
            const loc = localization.get("new.share.full-name");
            fullName = localization.putParameters(loc, new Map([
                ["firstName", detail["details"]["firstName"]],
                ["lastName", detail["details"]["lastName"]]
            ]));
        } else {
            fullName = localization.get("new.share.guest");
        }
        let infoText = localization.get("new.share.request-info");
        infoText = localization.putParameters(infoText, new Map([
            ["fullName", fullName],
            ["ipAddress", detail["details"]["ipAddress"]]
        ]));

        // step aside, the request dialog takes the overlay over
        this.hide();
        const server = ctx["server"];
        server.addEventListener("pair-reject", this.onPairReject);
        server.addEventListener("pair-accept", this.onPairAccept);
        server.addEventListener("offline", this.onOffline);

        await ctx["ui"].openDialog("room-request", {
            "info": infoText,
            "showRemember": detail["showRemember"],
            "timeout": detail["timeout"]
        }, true);
    };

    forgetRequest() {
        const server = this.ctx["server"];
        server.removeEventListener("pair-reject", this.onPairReject);
        server.removeEventListener("pair-accept", this.onPairAccept);
        server.removeEventListener("offline", this.onOffline);
    };

    onPairReject = () => {
        console.log("Pair reject");
        this.forgetRequest();
        this.ctx["ui"].closeDialog("room-request");
        this.show();
    };
    onPairAccept = (event) => {
        console.log("Pair accept");
        console.log(event.detail);
        this.forgetRequest();
        this.ctx["ui"].closeDialogs();
        // todo: open room screen
    };
    onOffline = () => {
        this.forgetRequest();
    };
};

export { RoomCreateDialog };
export default RoomCreateDialog;
