"use strict";

// the version, and the list of what this client cannot do - everything on it is
// something the desktop shell would have

// first-party dependencies
import { Panel } from "../../../../src/view.js";

const AboutWindow = class extends Panel {
    static id = "settings.about";
    static mountPoint = "#settings-windows";
    static rootId = "settings-about";

    async mount(ctx) {
        const desktop = ctx["desktop"];
        const browser = ctx["ui"].env.browser;

        this.version = document.getElementById("about-version");
        this.version.innerText = ctx["conf"]["version"];

        this.supported = document.getElementById("about-supported");
        let isMissing = false;

        // check autolaunch support
        this.autoLanuch = document.getElementById("about-auto-launch");
        if (desktop.isAvailable === false) {
            isMissing = true;
            this.autoLanuch.classList.remove("hide");
        }

        // check tray support
        this.tray = document.getElementById("about-tray");
        if (desktop.isAvailable === false) {
            isMissing = true;
            this.tray.classList.remove("hide");
        }

        // check system audio share support
        this.systemAudio = document.getElementById("about-audio");
        this.systemAudio2 = document.getElementById("about-audio-unsupported");
        if (desktop.isAvailable === false) {
            isMissing = true;
            if (browser["isChrome"] || browser["isOpera"] || browser["isEdgeChromium"]) {
                this.systemAudio.classList.remove("hide");
            } else {
                this.systemAudio2.classList.remove("hide");
            }
        }

        // check screen share support
        this.screenShare = document.getElementById("about-screen");
        if (desktop.isAvailable === false) {
            isMissing = true;
            this.screenShare.classList.remove("hide");
        }

        // check play support
        this.playback = document.getElementById("about-play");
        if (desktop.isAvailable === false && (typeof VideoDecoder === "undefined" || typeof AudioDecoder === "undefined")) {
            isMissing = true;
            this.playback.classList.remove("hide");
        }

        // check control share support
        this.controlShare = document.getElementById("about-control");
        if (desktop.isAvailable === false) {
            isMissing = true;
            this.controlShare.classList.remove("hide");
        }

        if (isMissing === false) {
            this.supported.classList.remove("hide");
        }
    };
};

export { AboutWindow };
export default AboutWindow;
