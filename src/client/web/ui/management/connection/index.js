"use strict";

// the settings of one connection, from either list that shows one - what this
// client calls it, and forgetting it for good.
//
// Both are the whole of what a connection can be told to do today: a name is
// this side's own column on the row (join-rename), and deleting drops the row
// itself, so the two codes stop opening anything and the other side is told.
//
// **The live share is the same two answers about a connection that is kept
// nowhere** (`isLive`, from the card the shares screen draws of the room
// itself). There is no row under it: the name is the room's and stands only
// while the connection does, and deleting a share that *is* only a connection
// is ending it. The dialog is the same one either way - the same field and the
// same button - because a host that has just let somebody in should not have to
// learn a second screen for the connection it did not tick a box for.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const ConnectionDialog = class extends Dialog {
    static id = "connection";
    static rootId = "dialog-connection";

    joinId = "";
    isLive = false;
    nameInput = null;
    hint = null;

    async mount(ctx) {
        this.nameInput = document.getElementById("input-connection-name");
        this.hint = document.getElementById("connection-name-hint");

        document.getElementById("btn-connection-close").addEventListener("click", () => {
            this.requestClose();
        });
        document.getElementById("btn-connection-save").addEventListener("click", () => {
            this.save();
        });
        document.getElementById("btn-connection-delete").addEventListener("click", () => {
            this.remove();
        });
    };

    // the name goes to the server as well as here, so this is a call that can
    // fail on a connection that has just dropped
    async save() {
        const ctx = this.ctx;
        const localization = ctx["localization"];

        // nothing to write it on, and nothing that has to be told: the name is
        // the room's own for as long as the room is, and the card behind this
        // dialog follows the room's `name` event
        if (this.isLive === true) {
            ctx["room"].setName(this.nameInput.value.trim());
            ctx["ui"].snackbar.show(localization.get("connection.saved"));
            this.requestClose();
            return;
        }
        try {
            const record = await ctx["joins"].rename(this.joinId, this.nameInput.value.trim());
            if (typeof record === "undefined") {
                ctx["ui"].snackbar.show(localization.get("connection.unknown"), true);
            } else {
                ctx["ui"].snackbar.show(localization.get("connection.saved"));
            }
        } catch (error) {
            console.error(error);
            ctx["ui"].snackbar.show(localization.get("connection.failed"), true);
        }
        this.requestClose();
    };

    // the delete of the card, in the dialog that is about the same connection:
    // it goes on both sides, so nothing is asked twice about a code that opens
    // nothing any more
    async remove() {
        const ctx = this.ctx;

        // there is no row to drop, so what is deleted is the connection itself -
        // the other side is told through the server, as it is for any leaving
        if (this.isLive === true) {
            ctx["room"].leave();
            ctx["ui"].snackbar.show(ctx["localization"].get("connection.disconnected"));
            this.requestClose();
            return;
        }
        try {
            await ctx["joins"].remove(this.joinId);
            ctx["ui"].snackbar.show(ctx["localization"].get("connection.deleted"));
        } catch (error) {
            console.error(error);
        }
        this.requestClose();
    };

    // Nothing is handed back to whoever opened this. Both answers change the
    // records themselves and the list behind the dialog follows those - see the
    // change event in src/joins.js - so closing is the base's requestClose(),
    // which leaves the router the one that knows what is open.

    open(params) {
        this.joinId = params?.["joinId"] ?? "";

        // a connection with no id is the live one, and only the caller knows
        // that - an empty id from anywhere else is a connection this device no
        // longer holds, which is what save() answers with
        this.isLive = (params?.["isLive"] === true && this.joinId === "");

        this.nameInput.value = (this.isLive === true
            ? this.ctx["room"].getName()
            : this.ctx["joins"].get(this.joinId)?.["name"] ?? "");

        // the line under the field says what the name is worth, and that is not
        // the same sentence for a name on a row and one on a connection
        this.hint.innerText = this.ctx["localization"].get(this.isLive === true ? "connection.liveHint" : "connection.nameHint");

        super.open(params);
        this.nameInput.focus();
    };
};

export { ConnectionDialog };
export default ConnectionDialog;
