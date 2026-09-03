"use strict";

// every device signed in to this account, each with its sign-out button - not
// served today (dev/plans/ws-accounts.md), so the list opens empty

// first-party dependencies
import { Panel } from "../../../../src/view.js";

const SessionsWindow = class extends Panel {
    static id = "account.sessions";
    static mountPoint = "#account-windows";
    static rootId = "account-sessions";

    sessions = [];

    async mount(ctx) {
        this.sessionList = document.getElementById("sessions-list");
    };

    open(params) {
        super.open(params);
        this.clear();
    };
    close() {
        super.close();
        this.clear();
    };

    clear() {
        for (const session of this.sessions) {
            session.el.remove();
        }
        this.sessions = [];
    };
};

export { SessionsWindow };
export default SessionsWindow;
