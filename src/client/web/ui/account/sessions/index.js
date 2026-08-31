"use strict";

// every device signed in to this account, this one first, each one with the
// button that signs it out

// first-party dependencies
import { Panel } from "../../../src/view.js";
import SessionBox from "./session-box.js";

const SessionsWindow = class extends Panel {
    static id = "account.sessions";
    static mountPoint = "#account-windows";
    static rootId = "account-sessions";

    sessions = [];

    async mount(ctx) {
        this.sessionList = document.getElementById("sessions-list");
    };

    createBox(data, isLocal) {
        const box = new SessionBox(
            this.ctx["localization"],
            data["sessionId"],
            data["lastUsed"],
            data["ipAddress"],
            data["userAgent"],
            isLocal
        );
        box.addEventListener("delete", this.onSessionDelete);
        return box;
    };

    onSessionChanged = (event) => {
        const detail = event.detail;
        detail["userAgent"] = JSON.parse(detail["userAgent"] || "{}");
        for (const session of this.sessions) {
            if (session.sessionId === detail["sessionId"]) {
                session.changeData(detail["lastUsed"], detail["ipAddress"], detail["userAgent"]);
                break;
            }
        }
    };
    onSessionAdded = (event) => {
        const detail = event.detail;
        detail["userAgent"] = JSON.parse(detail["userAgent"] || "{}");
        const box = this.createBox(detail, false);
        this.sessions.push(box);
        this.sessionList.appendChild(box.el);
    };
    onSessionRemoved = (event) => {
        const detail = event.detail;
        for (const session of this.sessions) {
            if (session["sessionId"] === detail) {
                session.el.remove();
                this.sessions.splice(this.sessions.indexOf(session), 1);
                break;
            }
        }
    };
    onSessionDelete = async (event) => {
        const sessionId = event.detail.sessionId;
        const res = await this.ctx["server"].logout(sessionId);
        if (res === true) {
            const box = this.sessions.find(function(session) {
                return session.sessionId === sessionId;
            });
            if (box !== undefined) {
                box.el.remove();
                this.sessions.splice(this.sessions.indexOf(box), 1);
            }
        }
    };

    async open(params) {
        const server = this.ctx["server"];
        super.open(params);

        // load sessions
        this.clear();
        const sessions = await server.getUserData("sessions");
        for (const sessionData of sessions) {
            sessionData["userAgent"] = JSON.parse(sessionData["userAgent"] || "{}");
            if (sessionData["sessionId"] === server.loginState["sessionId"]) {
                const box = this.createBox(sessionData, true);
                this.sessions.unshift(box);
                this.sessionList.prepend(box.el);
            } else {
                const box = this.createBox(sessionData, false);
                this.sessions.push(box);
                this.sessionList.appendChild(box.el);
            }
        }

        server.addEventListener("session-changed", this.onSessionChanged);
        server.addEventListener("session-added", this.onSessionAdded);
        server.addEventListener("session-removed", this.onSessionRemoved);
    };
    async close() {
        const server = this.ctx["server"];
        super.close();

        this.clear();
        await server.unsubscribeUserData("sessions");

        server.removeEventListener("session-removed", this.onSessionRemoved);
        server.removeEventListener("session-changed", this.onSessionChanged);
        server.removeEventListener("session-added", this.onSessionAdded);
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
