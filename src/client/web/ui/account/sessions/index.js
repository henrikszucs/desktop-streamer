"use strict";

// every device signed in to this account, this one first, each one with the
// button that signs it out
//
// The list came from the user data of the server and each box from
// ./session-box.js. Neither the sessions nor the sign-out they need is served
// today (dev/plans/ws-accounts.md), so the window opens on an empty list and
// session-box.js waits there for it.

// first-party dependencies
import { Panel } from "../../../src/view.js";

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
