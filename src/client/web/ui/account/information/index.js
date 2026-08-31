"use strict";

// the name and the e-mail behind the account, subscribed while the window is
// open and unsubscribed the moment it is not

// first-party dependencies
import { Panel } from "../../../src/view.js";

const InformationWindow = class extends Panel {
    static id = "account.information";
    static mountPoint = "#account-windows";
    static rootId = "account-information";

    async mount(ctx) {
        this.email = document.getElementById("account-email");
        this.firstName = document.getElementById("account-firstname");
        this.lastName = document.getElementById("account-lastname");

        ctx["server"].addEventListener("user-data", (event) => {
            const type = event.detail.type;
            const value = event.detail.value;
            if (type === "email") {
                this.email.value = value;
            } else if (type === "firstName") {
                this.firstName.value = value;
            } else if (type === "lastName") {
                this.lastName.value = value;
            }
        });
    };

    async open(params) {
        const server = this.ctx["server"];
        super.open(params);

        // subscribe to user info updates
        const email = await server.getUserData("email");
        const firstName = await server.getUserData("firstName");
        const lastName = await server.getUserData("lastName");
        this.email.value = email || "";
        this.firstName.value = firstName || "";
        this.lastName.value = lastName || "";
    };
    async close() {
        const server = this.ctx["server"];
        super.close();

        //unsubscribe from user info updates
        this.email.value = "";
        this.firstName.value = "";
        this.lastName.value = "";
        await server.unsubscribeUserData("email");
        await server.unsubscribeUserData("firstName");
        await server.unsubscribeUserData("lastName");
    };
};

export { InformationWindow };
export default InformationWindow;
