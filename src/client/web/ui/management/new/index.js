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
        this.displayJoinError("");
        console.warn("Joining is not wired to the server yet");
    };
};

export { NewScreen };
export default NewScreen;
