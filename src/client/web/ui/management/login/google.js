"use strict";

// the Google Identity button, loaded from Google itself. The callback it wants
// is a global by name, so there is one of these per page.

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

// how long the button is given to render before the screen gives up on it
const LOAD_TIMEOUT = 10000;

const GoogleLogin = class extends EventTarget {
    constructor(clientId) {
        super();

        // store client id
        this.clientId = clientId;

        // global callback function
        window.onGoogleLogin = async (response) => {
            this.dispatchEvent(
                new CustomEvent("login", {"detail": response})
            );
        }
    };
    // fetch Google's script; resolves true when it is usable, false when it
    // could not be loaded. A failed tag is removed so the next call tries again.
    load() {
        if (typeof window["google"]?.["accounts"]?.["id"] !== "undefined") {
            return Promise.resolve(true);
        }
        if (typeof this.loading !== "undefined") {
            return this.loading;
        }
        this.loading = new Promise((resolve) => {
            let googleScript = document.querySelector("head script[src=\"" + SCRIPT_SRC + "\"]");
            if (googleScript === null) {
                googleScript = document.createElement("script");
                googleScript.setAttribute("src", SCRIPT_SRC);
                document.head.appendChild(googleScript);
            }
            const done = (isLoaded) => {
                clearTimeout(timeoutId);
                this.loading = undefined;
                if (isLoaded === false) {
                    googleScript.remove();
                }
                resolve(isLoaded);
            };
            const timeoutId = setTimeout(done, LOAD_TIMEOUT, false);
            googleScript.addEventListener("load", () => done(true), {"once": true});
            googleScript.addEventListener("error", () => done(false), {"once": true});
        });
        return this.loading;
    };
    // render the button into el; false when Google's script is not there
    async createButton(el) {
        const isLoaded = await this.load();
        if (isLoaded === false) {
            return false;
        }
        el.innerHTML = "<div></div>";
        window["google"]["accounts"]["id"].initialize({
            "client_id": this.clientId,
            "callback": window.onGoogleLogin,
            "context": "signin",
            "ux_mode": "popup",
            "auto_prompt": false
        });
        window["google"]["accounts"]["id"].renderButton(el.firstElementChild, {
            "logo_alignment": "left",
            "shape": "pill",
            "size": "large",
            "text": "signin_with",
            "theme": "filled_blue",
            "type": "standard"
        });
        return true;
    };
    decodeJWT(token) {
        // note: you can extract the credential data but google API guarantees its validity
        let base64Url = token.split(".")[1];
        let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        let jsonPayload = decodeURIComponent(atob(base64).split("").map(function (c) {
                return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            }).join("")
        );
        return JSON.parse(jsonPayload);
    };
};

export { GoogleLogin };
export default GoogleLogin;
