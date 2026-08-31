"use strict";

// one signed-in device in the sessions list. A repeated component, so its markup
// is a template literal.

const SessionBox = class extends EventTarget {
    constructor(localization, sessionId, lastUsed, ipAddress, userAgent, isLocal) {
        super();
        this.localization = localization;
        this.sessionId = sessionId;
        let localHtml = "";
        if (isLocal === true) {
            localHtml = `<span> | </span><span class="bold tertiary-text">` + localization.get("account.sessions.this-device") + `</span>`;
        }
        const html = `
            <div class="session-box">
                <div>
                    <i>computer</i>
                    <span class="bold session-platform"></span>
                    <span> | </span>
                    <span class="tertiary-text session-lastused"></span>
                    <span> | </span>
                    <span class="tertiary-text session-ip"></span>
                    <span class="session-local">`+localHtml+`</span>
                </div>
                <div>
                    <button class="circle large error btn-session-delete">
                        <i>delete</i>
                        <span class="l m">Delete</span>
                    </button>
                </div>
            </div>
        `;
        const div = document.createElement("div");
        div.innerHTML = html.trim();
        this.el = div.firstChild;
        this.elPlatform = this.el.querySelector(".session-platform");
        this.elLastUsed = this.el.querySelector(".session-lastused");
        this.elIp = this.el.querySelector(".session-ip");
        this.changeData(lastUsed, ipAddress, userAgent);
        this.btnDelete = this.el.querySelector(".btn-session-delete");
        this.btnDelete.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("delete", {"detail": {"sessionId": this.sessionId}}));
        });
    };
    changeData(lastUsed, ipAddress, userAgent) {
        const localization = this.localization;

        // format data
        if (lastUsed !== undefined) {
            lastUsed = localization.get("account.sessions.last-active") + ": " + new Date(lastUsed).toLocaleString(localization.getLang(), { timeZone: "UTC" });
            this.elLastUsed.innerText = lastUsed;
        }

        if (ipAddress !== undefined) {
            ipAddress = localization.get("account.sessions.ip-address") + ": " + ipAddress;
            this.elIp.innerText = ipAddress;
        }

        if (userAgent !== undefined && typeof userAgent?.["os"] === "string") {
            let platform = "";
            if (userAgent["os"] === "win32") {
                platform = "Windows";
            } else if (userAgent["os"] === "darwin") {
                platform = "macOS";
            } else if (userAgent["os"] === "linux") {
                platform = "Linux";
            } else if (userAgent["os"] === "android") {
                platform = "Android";
            } else if (userAgent["os"] === "ios") {
                platform = "iOS";
            } else {
                platform = "Unknown OS";
            }

            this.elPlatform.innerText = platform;
        }
    };
};

export { SessionBox };
export default SessionBox;
