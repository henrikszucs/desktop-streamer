"use strict";

// the settings of one remembered connection, from either list that shows one -
// what this client calls it, and forgetting it for good.
//
// Both are the whole of what a connection can be told to do today: a name is
// this side's own column on the row (join-rename), and deleting drops the row
// itself, so the two codes stop opening anything and the other side is told.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const ConnectionDialog = class extends Dialog {
    static id = "connection";
    static rootId = "dialog-connection";

    joinId = "";
    nameInput = null;

    async mount(ctx) {
        this.nameInput = document.getElementById("input-connection-name");

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
        this.nameInput.value = this.ctx["joins"].get(this.joinId)?.["name"] ?? "";
        super.open(params);
        this.nameInput.focus();
    };
};

export { ConnectionDialog };
export default ConnectionDialog;
