"use strict";

// the sign-in screen, built from whatever the server says it supports. Only
// Google is wired today, and only when the server hands out a client id.
//
// The avatar and the user menu of the top bar belong to the shell, not here -
// they are on screen whether this route is or not.

// first-party dependencies
import { Screen } from "../../../src/view.js";
import GoogleLogin from "./google.js";

const LoginScreen = class extends Screen {
    static id = "login";
    static rootId = "screen-login";

    google = null;

    async mount(ctx) {
        this.googleBox = document.getElementById("google-login");
    };

    open(params) {
        this.setupGoogle();
        super.open(params);
    };

    setupGoogle() {
        const ctx = this.ctx;
        const clientId = ctx["conf"]["remote"]?.["auth"]?.["google"]?.["clientId"];
        if (typeof clientId === "undefined") {
            this.googleBox.classList.add("hide");
            return;
        }
        if (this.google === null) {
            this.google = new GoogleLogin(clientId);
            this.google.createButton(this.googleBox);
            this.google.addEventListener("login", function(event) {
                // the credential has nowhere to go until the server signs in
                // again (dev/plans/ws-accounts.md)
                console.warn("Sign-in is not wired to the server yet");
            });
        }
        this.googleBox.classList.remove("hide");
    };
};

export { LoginScreen };
export default LoginScreen;
