"use strict";

// the sign-in screen, built from whatever the server says it supports - only
// Google today, and only when the server hands out a client id - and the
// account recovery beneath it, which ends every session of an account instead
// of starting one. Google's button is the one way to get a credential, so the
// recovery has a Google button of its own, and the two are never on screen at
// once: which one is showing is what says what the credential is for.

// first-party dependencies
import { Screen } from "../../../src/view.js";
import GoogleLogin from "./google.js";

const LoginScreen = class extends Screen {
    static id = "login";
    static rootId = "screen-login";

    google = null;
    isButtonReady = false;
    isBusy = false;

    // what a credential that arrives is for: "login", or "recover" while the
    // recovery panel is the one holding a Google button
    mode = "login";

    async mount(ctx) {
        this.googleBox = document.getElementById("google-login");
        this.disabledBox = document.getElementById("login-disabled");
        this.unavailableBox = document.getElementById("login-unavailable");
        this.retryButton = document.getElementById("login-retry");
        this.recoveryBox = document.getElementById("login-recovery");
        this.recoveryStartRow = document.getElementById("login-recovery-start-row");
        this.recoveryStart = document.getElementById("login-recovery-start");
        this.recoveryPanel = document.getElementById("login-recovery-panel");
        this.recoverBox = document.getElementById("google-recover");
        this.recoveryCancel = document.getElementById("login-recovery-cancel");

        this.retryButton.addEventListener("click", () => {
            this.setupGoogle();
        });
        this.recoveryStart.addEventListener("click", () => {
            this.openRecovery();
        });
        this.recoveryCancel.addEventListener("click", () => {
            this.closeRecovery();
        });
    };

    open(params) {
        // a server with no provider at all has nothing on this screen, so the
        // screen says so; which provider is there is setupGoogle()'s question
        this.disabledBox.classList.toggle("hide", this.ctx["ui"].permissions.isAuth() === true);
        this.closeRecovery();
        this.setupGoogle();
        super.open(params);
    };

    close() {
        this.closeRecovery();
        super.close();
    };

    // the credential goes to the server, and a yes makes this client that
    // account: the bar follows on its own, and the screen it stood on is the
    // home one. A no says why in the snackbar, since the button says nothing.
    async login(credential) {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        if (typeof credential !== "string" || this.isBusy === true) {
            return;
        }
        this.isBusy = true;
        try {
            await ctx["account"].loginGoogle(credential);
            ctx["ui"].snackbar.show(localization.get("login.done"));
            ctx["ui"].navigate("new");
        } catch (error) {
            console.error("Sign-in failed:", error);
            const reason = ["register-disabled", "email-taken", "invalid-credential"].includes(error.message) ? error.message : "failed";
            ctx["ui"].snackbar.show(localization.get("login.error." + reason), true);
        }
        this.isBusy = false;
    };

    // the same credential, the other way round: every session of the account
    // ends and none starts. The screen stays, since signing in again is what
    // comes next; if this client was that account, the route is drawn again
    // as the guest it is now.
    async recover(credential) {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        if (typeof credential !== "string" || this.isBusy === true) {
            return;
        }
        this.isBusy = true;
        try {
            const result = await ctx["account"].recover(credential);
            ctx["ui"].snackbar.show(localization.get("login.recovery.done"));
            this.closeRecovery();
            if (result["wasLive"] === true) {
                ctx["ui"].closeDialogs();
                await ctx["ui"].reload();
            }
        } catch (error) {
            console.error("Account recovery failed:", error);
            const reason = ["invalid-credential", "unknown-user"].includes(error.message) ? error.message : "failed";
            ctx["ui"].snackbar.show(localization.get("login.recovery.error." + reason), true);
        }
        this.isBusy = false;
    };

    // the recovery panel takes the Google button over: the sign-in one goes
    // off screen, so the one credential that can arrive is a recovery
    async openRecovery() {
        if (this.google === null) {
            return;
        }
        this.mode = "recover";
        this.recoveryStartRow.classList.add("hide");
        this.recoveryPanel.classList.remove("hide");
        this.googleBox.classList.add("hide");
        this.recoveryStart.disabled = true;
        const isReady = await this.google.createButton(this.recoverBox);
        this.recoveryStart.disabled = false;
        if (isReady === false) {
            this.closeRecovery();
            this.unavailableBox.classList.remove("hide");
        }
    };

    closeRecovery() {
        this.mode = "login";
        this.recoveryPanel.classList.add("hide");
        this.recoveryStartRow.classList.remove("hide");
        this.recoverBox.innerHTML = "";
        if (this.isButtonReady === true) {
            this.googleBox.classList.remove("hide");
        }
    };

    // where the button's frame is served from: this page's own address in a
    // browser, the HTTP server's under the desktop shell, which is on local://
    buttonOrigin() {
        if (this.ctx["desktop"]?.isAvailable !== true) {
            return location.origin;
        }
        const http = this.ctx["conf"]["http"];
        return "https://" + http["domain"] + (http["port"] === 443 ? "" : ":" + http["port"]);
    };

    async setupGoogle() {
        const ctx = this.ctx;
        const clientId = ctx["conf"]["remote"]?.["auth"]?.["google"]?.["clientId"];
        this.unavailableBox.classList.add("hide");
        if (typeof clientId === "undefined") {
            this.googleBox.classList.add("hide");
            this.recoveryBox.classList.add("hide");
            return;
        }
        if (this.google === null) {
            this.google = new GoogleLogin(clientId, this.buttonOrigin());
            this.google.addEventListener("login", (event) => {
                const credential = event.detail?.["credential"];
                if (this.mode === "recover") {
                    this.recover(credential);
                } else {
                    this.login(credential);
                }
            });
        }
        this.googleBox.classList.remove("hide");
        if (this.isButtonReady === true) {
            this.recoveryBox.classList.remove("hide");
            return;
        }

        // a provider the server offers but the browser cannot reach - offline,
        // a blocked script - is a notice too, and one that can be tried again.
        // The recovery needs the same script, so it is shown with the button.
        this.retryButton.disabled = true;
        this.isButtonReady = await this.google.createButton(this.googleBox);
        this.retryButton.disabled = false;
        this.unavailableBox.classList.toggle("hide", this.isButtonReady === true);
        this.googleBox.classList.toggle("hide", this.isButtonReady === false);
        this.recoveryBox.classList.toggle("hide", this.isButtonReady === false);
    };
};

export { LoginScreen };
export default LoginScreen;
