"use strict";

// the Google Identity button, framed from the HTTP server rather than loaded
// into this page: the desktop shell's window runs with Node, and a frame never
// does, so Google's script runs where it cannot reach it (google-frame.js, and
// .claude/CLIENT.md, "Permissions")

const FRAME_PATH = "/ui/management/login/google-frame.html";

// how long a frame is given to say it has a button before the screen gives up
const LOAD_TIMEOUT = 15000;

// the size a frame is drawn at until it says its own
const FRAME_WIDTH = 400;
const FRAME_HEIGHT = 44;

const GoogleLogin = class extends EventTarget {
    // the frames this made, each with the answer to its createButton() while
    // it has not said ready or error
    frames = new Map();     // iframe -> resolve or null

    // `origin` is the HTTP server's, which is what Google has the client id for
    constructor(clientId, origin) {
        super();
        this.clientId = clientId;
        this.origin = origin;
        window.addEventListener("message", this.onMessage);
    };

    // only a frame this made, on the origin it was made from, is listened to
    onMessage = (event) => {
        if (event.origin !== this.origin) {
            return;
        }
        let frame = null;
        for (const held of this.frames.keys()) {
            if (held.contentWindow === event.source) {
                frame = held;
            }
        }
        if (frame === null) {
            return;
        }
        const message = event.data ?? {};
        if (message["type"] === "credential" && typeof message["credential"] === "string") {
            this.dispatchEvent(new CustomEvent("login", {"detail": {"credential": message["credential"]}}));
        } else if (message["type"] === "size") {
            frame.style.width = Math.max(1, Number(message["width"]) || FRAME_WIDTH) + "px";
            frame.style.height = Math.max(1, Number(message["height"]) || FRAME_HEIGHT) + "px";
        } else if (message["type"] === "ready" || message["type"] === "error") {
            this.settle(frame, message["type"] === "ready");
        }
    };

    settle(frame, isReady) {
        const resolve = this.frames.get(frame);
        if (typeof resolve !== "function") {
            return;
        }
        this.frames.set(frame, null);
        if (isReady === false) {
            frame.remove();
            this.frames.delete(frame);
        }
        resolve(isReady);
    };

    // render the button into el; false when the frame could not get one
    createButton(el) {
        el.replaceChildren();
        for (const held of [...this.frames.keys()]) {
            if (held.isConnected === false) {
                this.settle(held, false);
                this.frames.delete(held);
            }
        }

        const frame = document.createElement("iframe");
        frame.title = "Google";
        frame.src = this.origin + FRAME_PATH + "?clientId=" + encodeURIComponent(this.clientId);
        // FedCM, which Google's script uses where the browser has it, asks the
        // frame's permission policy
        frame.allow = "identity-credentials-get";
        frame.style.border = "0";
        frame.style.width = FRAME_WIDTH + "px";
        frame.style.height = FRAME_HEIGHT + "px";
        // the same scheme as the page inside, or the browser paints it opaque
        frame.style.colorScheme = "normal";
        frame.setAttribute("scrolling", "no");

        return new Promise((resolve) => {
            this.frames.set(frame, resolve);
            setTimeout(() => {
                this.settle(frame, false);
            }, LOAD_TIMEOUT);
            el.appendChild(frame);
        });
    };
};

export { GoogleLogin };
export default GoogleLogin;
