"use strict";

// the Google button, in the page the login screen frames from the HTTP server,
// so Google's script never runs in the desktop shell's window, which has Node -
// see .claude/CLIENT.md, "Permissions". It says three things to the page that
// framed it: {type: "ready" | "error"}, {type: "size", width, height} and
// {type: "credential", credential}.

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

// how long Google's script is given before the frame says it has none
const LOAD_TIMEOUT = 10000;

// who may be told a credential: the web client, on this page's own origin, and
// the desktop shell. A page anywhere else that frames this one hears nothing,
// since a credential is a sign-in to this server.
const PARENT_ORIGINS = [location.origin, "local://local.local"];

// posted to each allowed origin: the browser drops the one that is not the parent
const say = function(message) {
    for (const origin of PARENT_ORIGINS) {
        try {
            window.parent.postMessage(message, origin);
        } catch (error) {
            // an origin this browser cannot parse is nobody's
        }
    }
};

// framed, and by a page it may talk to - where the browser can say who that is
const isFramedByUs = function() {
    if (window.parent === window) {
        return false;
    }
    const ancestor = location.ancestorOrigins?.[0];
    return typeof ancestor !== "string" || PARENT_ORIGINS.includes(ancestor) === true;
};

const loadScript = function() {
    return new Promise(function(resolve) {
        const script = document.createElement("script");
        const timeoutId = setTimeout(resolve, LOAD_TIMEOUT, false);
        script.addEventListener("load", function() {
            clearTimeout(timeoutId);
            resolve(true);
        }, {"once": true});
        script.addEventListener("error", function() {
            clearTimeout(timeoutId);
            resolve(false);
        }, {"once": true});
        script.setAttribute("src", SCRIPT_SRC);
        document.head.appendChild(script);
    });
};

const main = async function() {
    if (isFramedByUs() === false) {
        return;
    }
    const clientId = new URLSearchParams(location.search).get("clientId") ?? "";
    if (clientId === "" || await loadScript() === false || typeof globalThis.google?.accounts?.id === "undefined") {
        say({"type": "error"});
        return;
    }

    const el = document.getElementById("google-button");
    globalThis.google.accounts.id.initialize({
        "client_id": clientId,
        "callback": function(response) {
            if (typeof response?.credential === "string") {
                say({"type": "credential", "credential": response.credential});
            }
        },
        "context": "signin",
        "ux_mode": "popup",
        "auto_prompt": false
    });
    // "medium" is never personalized, so it always reads "Sign in with Google"
    // and shows nobody's picture - see .claude/CLIENT.md
    globalThis.google.accounts.id.renderButton(el, {
        "logo_alignment": "left",
        "shape": "pill",
        "size": "medium",
        "width": 400,           // the widest Google draws; the login screen scales the rest
        "text": "signin_with",
        "theme": "filled_blue",
        "type": "standard"
    });

    // Google draws the button in its own time, so its size is said as it lands
    new ResizeObserver(function() {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            say({"type": "size", "width": Math.ceil(rect.width), "height": Math.ceil(rect.height)});
        }
    }).observe(el);
    say({"type": "ready"});
};

main();
