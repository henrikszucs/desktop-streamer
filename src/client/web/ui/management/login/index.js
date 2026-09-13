"use strict";

// the sign-in screen, built from whatever the server says it supports - only
// Google today, and only when the server hands out a client id

// first-party dependencies
import { Screen } from "../../../src/view.js";
import GoogleLogin from "./google.js";

const LoginScreen = class extends Screen {
    static id = "login";
    static rootId = "screen-login";

    google = null;
    isButtonReady = false;
    isBusy = false;

    async mount(ctx) {
        this.googleBox = document.getElementById("google-login");
        this.disabledBox = document.getElementById("login-disabled");
        this.unavailableBox = document.getElementById("login-unavailable");
        this.retryButton = document.getElementById("login-retry");

        this.retryButton.addEventListener("click", () => {
            this.setupGoogle();
        });
    };

    open(params) {
        // a server with no provider at all has nothing on this screen, so the
        // screen says so; which provider is there is setupGoogle()'s question
        this.disabledBox.classList.toggle("hide", this.ctx["ui"].permissions.isAuth() === true);
        this.setupGoogle();
        super.open(params);
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

    async setupGoogle() {
        const ctx = this.ctx;
        const clientId = ctx["conf"]["remote"]?.["auth"]?.["google"]?.["clientId"];
        this.unavailableBox.classList.add("hide");
        if (typeof clientId === "undefined") {
            this.googleBox.classList.add("hide");
            return;
        }
        if (this.google === null) {
            this.google = new GoogleLogin(clientId);
            this.google.addEventListener("login", (event) => {
                this.login(event.detail?.["credential"]);
            });
        }
        this.googleBox.classList.remove("hide");
        if (this.isButtonReady === true) {
            return;
        }

        // a provider the server offers but the browser cannot reach - offline,
        // a blocked script - is a notice too, and one that can be tried again
        this.retryButton.disabled = true;
        this.isButtonReady = await this.google.createButton(this.googleBox);
        this.retryButton.disabled = false;
        this.unavailableBox.classList.toggle("hide", this.isButtonReady === true);
        this.googleBox.classList.toggle("hide", this.isButtonReady === false);
    };
};

export { LoginScreen };
export default LoginScreen;
