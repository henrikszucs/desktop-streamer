"use strict";

// the settings of one remembered connection, from either list that shows one -
// what this client calls it, and forgetting it for good.
//
// Both are the whole of what a connection can be told to do today: a name has
// no call that carries it to the other side, so it is local (see rename() in
// src/joins.js), and deleting is the one that is not - it drops the row, so the
// two codes stop opening anything and the other side is told.

// first-party dependencies
import { Dialog } from "../../../src/view.js";

const ConnectionDialog = class extends Dialog {
    static id = "connection";
    static rootId = "dialog-connection";

    joinId = "";

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

    async save() {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        const record = await ctx["joins"].rename(this.joinId, this.nameInput.value.trim());
        if (typeof record === "undefined") {
            ctx["ui"].snackbar.show(localization.get("connection.unknown"), true);
        } else {
            ctx["ui"].snackbar.show(localization.get("connection.saved"));
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
