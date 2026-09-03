"use strict";

// the Google Identity button, loaded from Google itself. The callback it wants
// is a global by name, so there is one of these per page.

const GoogleLogin = class extends EventTarget {
    constructor(clientId) {
        super();

        // load google script if not already loaded
        const scriptSrc = "https://accounts.google.com/gsi/client";
        if (document.querySelector("head script[src=\"" + scriptSrc + "\"]") === null) {
            const googleScript = document.createElement("script");
            googleScript.setAttribute("src", scriptSrc);
            document.head.appendChild(googleScript);
        }

        // store client id
        this.clientId = clientId;

        // global callback function
        window.onGoogleLogin = async (response) => {
            this.dispatchEvent(
                new CustomEvent("login", {"detail": response})
            );
        }
    };
    createButton(el) {
        el.innerHTML = "<div data-auto_prompt=false data-callback=onGoogleLogin data-client_id=" + this.clientId + " data-context=signin data-ux_mode=popup id=g_id_onload></div><div class=g_id_signin data-logo_alignment=left data-shape=pill data-size=large data-text=signin_with data-theme=filled_blue data-type=standard></div>";
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
