"use strict";

// the guest's delete: there is no account behind it, so deleting it is what its
// sign out already is - the bar's logout, which asks first and starts the
// client over as a new guest. One call, so the two cannot drift apart.

// first-party dependencies
import { Panel } from "../../../../src/view.js";

const ResetWindow = class extends Panel {
    static id = "account.reset";
    static mountPoint = "#account-windows";
    static rootId = "account-reset";

    async mount(ctx) {
        this.resetBtn = document.getElementById("btn-account-reset-confirm");
        this.resetBtn.addEventListener("click", () => {
            this.reset();
        });
    };

    // the confirmation opens over this dialog and a yes closes every dialog
    // on its way out, so nothing is left to close here
    async reset() {
        this.resetBtn.disabled = true;
        try {
            const navTop = await this.ctx["ui"].loadModule("nav-top");
            await navTop.logout();
        } catch (error) {
            console.error(error);
        }
        this.resetBtn.disabled = false;
    };
};

export { ResetWindow };
export default ResetWindow;
