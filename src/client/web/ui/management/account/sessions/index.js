"use strict";

// every device signed in to this account, each with its sign-out button. The
// list is read when the window opens - a session is not something that changes
// under a screen often enough to be pushed.

// first-party dependencies
import { Panel } from "../../../../src/view.js";
import SessionBox from "./session-box.js";

const SessionsWindow = class extends Panel {
    static id = "account.sessions";
    static mountPoint = "#account-windows";
    static rootId = "account-sessions";

    sessions = [];

    async mount(ctx) {
        this.sessionList = document.getElementById("sessions-list");
        this.emptyNotice = document.getElementById("sessions-empty");
        this.errorNotice = document.getElementById("sessions-error");
    };

    async load() {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        this.clear();
        this.errorNotice.classList.add("hide");

        let sessions = [];
        try {
            sessions = await ctx["account"].sessions();
        } catch (error) {
            console.error(error);
            this.errorNotice.classList.remove("hide");
            return;
        }
        if (this.el.classList.contains("hide") === true) {
            return;     // closed while the answer was on its way
        }

        for (const session of sessions) {
            const box = new SessionBox(localization, session["sessionId"], session["lastUsed"], session["ipAddress"], session["userAgent"], session["isCurrent"] === true);

            // signing out this device is the bar's sign out, so the two cannot
            // drift apart; another device is ended here and its row goes
            box.addEventListener("delete", async () => {
                box.btnDelete.disabled = true;
                try {
                    if (session["isCurrent"] === true) {
                        const navTop = await ctx["ui"].loadModule("nav-top");
                        await navTop.logout();
                        return;
                    }
                    await ctx["account"].endSession(session["sessionId"]);
                    box.el.remove();
                    this.sessions = this.sessions.filter(function(held) {
                        return held !== box;
                    });
                    this.emptyNotice.classList.toggle("hide", this.sessions.length > 0);
                } catch (error) {
                    console.error(error);
                    ctx["ui"].snackbar.show(localization.get("account.sessions.failed"), true);
                }
                box.btnDelete.disabled = false;
            });
            this.sessions.push(box);
            this.sessionList.appendChild(box.el);
        }
        this.emptyNotice.classList.toggle("hide", this.sessions.length > 0);
    };

    open(params) {
        super.open(params);
        this.load();
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
        this.emptyNotice.classList.add("hide");
    };
};

export { SessionsWindow };
export default SessionsWindow;
