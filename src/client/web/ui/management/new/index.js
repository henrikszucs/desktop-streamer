"use strict";

// the default screen: join a room with a code, or share this device
//
// it owns both flows, so the dialogs of a flow are opened from here and the
// result comes back to the field that started it. The share flow hands over to
// room-create, which carries it from there.
//
// Neither flow can go through today: the pair code the join asks about and the
// answer it waits for both went with the pairing server
// (dev/plans/ws-pairing-joins.md). The field and the two buttons are here, and
// the join stops at the point where the code would be sent.
//
// Both flows are also a permission the server answers - guestAllowJoin and
// guestAllowShare - so each of them is either on screen or replaced by the
// notice that says why it is not.

// first-party dependencies
import { Screen } from "../../../src/view.js";

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

    //
    // the permissions
    //
    // What the server would refuse is taken off the screen rather than left to
    // fail at the point of use, and the notice in its place says why. This runs
    // on every open() - every navigation here, and every reconnect - so a
    // server that comes back configured differently is followed.
    applyPermissions() {
        const permissions = this.ctx["ui"].permissions;
        const isAuth = permissions.isAuth();
        this.setFlow(this.joinBox, this.joinDenied, this.joinLoginBtn, permissions.allows("guestAllowJoin"), isAuth);
        this.setFlow(this.shareBox, this.shareDenied, this.shareLoginBtn, permissions.allows("guestAllowShare"), isAuth);
    };

    // one flow: itself, or the notice - and the notice offers the sign-in only
    // when there is a sign-in to offer
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
    // answer in the joining dialog
    async join(code) {
        this.displayJoinError("");
        console.warn("Joining is not wired to the server yet");
    };
};

export { NewScreen };
export default NewScreen;
