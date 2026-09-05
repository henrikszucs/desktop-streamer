"use strict";

// the default screen: join a room with a code, or share this device. It owns
// both flows; neither goes through yet (dev/plans/ws-pairing-joins.md).

// first-party dependencies
import { Screen } from "../../../src/view.js";

// the shape of a join code, the same six digits the server hands out
const CODE_PATTERN = /^[0-9]{6}$/;

const NewScreen = class extends Screen {
    static id = "new";
    static rootId = "screen-new";

    async mount(ctx) {
        // get important elements
        this.joinCode = document.getElementById("input-new-code");
        this.joinBtn = document.getElementById("btn-new-join");
        this.createBtn = document.getElementById("btn-new-create");

        // each flow, the notice that stands in for it, and the sign-in button
        // of that notice
        this.joinBox = document.getElementById("new-join");
        this.joinDenied = document.getElementById("new-join-denied");
        this.joinLoginBtn = document.getElementById("btn-new-join-login");
        this.shareBox = document.getElementById("new-share");
        this.shareDenied = document.getElementById("new-share-denied");
        this.shareLoginBtn = document.getElementById("btn-new-share-login");

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
        this.applyPermissions();
        super.open(params);
    };
    close() {
        this.joinCode.value = "";
        this.displayJoinError("");
        super.close();
    };

    // what the server would refuse is replaced by the notice that says why, on
    // every open() so a server that comes back configured differently is followed
    applyPermissions() {
        const permissions = this.ctx["ui"].permissions;
        const isAuth = permissions.isAuth();
        this.setFlow(this.joinBox, this.joinDenied, this.joinLoginBtn, permissions.allows("guestAllowJoin"), isAuth);
        this.setFlow(this.shareBox, this.shareDenied, this.shareLoginBtn, permissions.allows("guestAllowShare"), isAuth);
    };

    // one flow: itself, or the notice - which offers the sign-in only when there
    // is one to offer
    setFlow(box, denied, loginBtn, isAllowed, isAuth) {
        box.classList.toggle("hide", isAllowed === false);
        denied.classList.toggle("hide", isAllowed === true);
        loginBtn.classList.toggle("hide", isAllowed === true || isAuth === false);
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
    // answer in the joining dialog - which owns the request from here on
    join(code) {
        this.displayJoinError("");

        // what was read off another screen and typed back in: the digits are
        // what matters, whatever was put between them
        const pairCode = code.replace(/[^0-9]/g, "");
        if (CODE_PATTERN.test(pairCode) === false) {
            this.displayJoinError(this.ctx["localization"].get("new.join.code-invalid"));
            return;
        }
        this.ctx["ui"].openDialog("room-joining", {"pairCode": pairCode});
    };
};

export { NewScreen };
export default NewScreen;
