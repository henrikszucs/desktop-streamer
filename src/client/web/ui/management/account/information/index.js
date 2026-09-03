"use strict";

// the name and the e-mail behind the account - nothing carries the user data
// today (dev/plans/ws-accounts.md), so the window opens empty

// first-party dependencies
import { Panel } from "../../../../src/view.js";

const InformationWindow = class extends Panel {
    static id = "account.information";
    static mountPoint = "#account-windows";
    static rootId = "account-information";

    async mount(ctx) {
        this.email = document.getElementById("account-email");
        this.firstName = document.getElementById("account-firstname");
        this.lastName = document.getElementById("account-lastname");
    };

    open(params) {
        super.open(params);
        this.email.value = "";
        this.firstName.value = "";
        this.lastName.value = "";
    };
    close() {
        super.close();
        this.email.value = "";
        this.firstName.value = "";
        this.lastName.value = "";
    };
};

export { InformationWindow };
export default InformationWindow;
