"use strict";

// the version, the list of what this client cannot do - everything on it is
// something the desktop shell would have - and the reset of the local settings

// first-party dependencies
import { Panel } from "../../../../src/view.js";

const AboutWindow = class extends Panel {
    static id = "settings.about";
    static mountPoint = "#settings-windows";
    static rootId = "settings-about";

    async mount(ctx) {
        const desktop = ctx["desktop"];
        const stream = ctx["stream"];

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
            if (stream.isAudioShareSupported() === true) {
                this.systemAudio.classList.remove("hide");
            } else {
                this.systemAudio2.classList.remove("hide");
            }
        }

        // check screen share support: a browser with WebCodecs shares what
        // its picker is given, one without shares nothing
        this.screenShare = document.getElementById("about-screen");
        this.screenShare2 = document.getElementById("about-screen-unsupported");
        if (desktop.isAvailable === false) {
            isMissing = true;
            if (stream.isShareSupported() === true) {
                this.screenShare.classList.remove("hide");
            } else {
                this.screenShare2.classList.remove("hide");
            }
        }

        // check play support: the picture and the sound decode apart, and a
        // browser without the sound decoder still plays the picture
        this.playback = document.getElementById("about-play");
        if (desktop.isAvailable === false && typeof VideoDecoder === "undefined") {
            isMissing = true;
            this.playback.classList.remove("hide");
        }
        this.playbackAudio = document.getElementById("about-play-audio");
        if (desktop.isAvailable === false && typeof AudioDecoder === "undefined") {
            isMissing = true;
            this.playbackAudio.classList.remove("hide");
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

        this.resetBtn = document.getElementById("btn-about-reset");
        this.resetBtn.addEventListener("click", () => {
            this.reset();
        });
    };

    // every setting to its default, behind a confirmation. The defaults are
    // written and applied in place - the theme, the language, the tray, the
    // same way boot applies them - and the other windows read the values on
    // their next open. Auto launch is a state of the system rather than a
    // row, so it is switched off by name.
    async reset() {
        const ctx = this.ctx;
        const localization = ctx["localization"];
        const isConfirmed = await ctx["ui"].confirm({"message": "confirm.resetSettings", "confirm": "confirm.reset"});
        if (isConfirmed === false) {
            return;
        }
        this.resetBtn.disabled = true;
        try {
            await ctx["resetLocal"]();
            ctx["ui"].applyLocal();
            if (ctx["desktop"].isAvailable === true) {
                try {
                    await ctx["desktop"].autoLaunch.disable();
                } catch (error) {
                    console.error("Cannot disable auto launch:", error);
                }
            }
            ctx["ui"].snackbar.show(localization.get("settings.about.reset-done"));
        } catch (error) {
            console.error(error);
            ctx["ui"].snackbar.show(localization.get("settings.about.reset-failed"), true);
        }
        this.resetBtn.disabled = false;
    };
};

export { AboutWindow };
export default AboutWindow;
