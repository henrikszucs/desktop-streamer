"use strict";

// the cameras and the screens, a preview for both - the screen preview goes
// through the same encoder and decoder a room would use, via ctx["stream"]

// first-party dependencies
import { Panel } from "../../../../src/view.js";
import { listDevices } from "../media-devices.js";

const VideoWindow = class extends Panel {
    static id = "settings.video";
    static mountPoint = "#settings-windows";
    static rootId = "settings-video";

    async mount(ctx) {
        const desktop = ctx["desktop"];
        const localization = ctx["localization"];

        // decoder support
        this.decoderVideoSupport = document.getElementById("decoder-video-support");
        this.decoderVideoUnsupport = document.getElementById("decoder-video-unsupport");
        if (typeof VideoDecoder !== "undefined") {
            this.decoderVideoSupport.classList.remove("hide");
        } else {
            this.decoderVideoUnsupport.classList.remove("hide");
        }

        // camera
        this.cameraSelect = document.getElementById("select-camera-input");
        this.cameraRefresh = document.getElementById("btn-camera-refresh");
        this.cameraTest = document.getElementById("btn-camera-test");
        navigator.mediaDevices.addEventListener("devicechange", () => {
            this.listCam();
        });
        this.cameraRefresh.addEventListener("click", () => {
            this.listCam();
        });
        this.cameraSelect.addEventListener("change", (event) => {
            this.cameraTest.disabled = (event.target.value === "");
        });

        this.cameraVideo = document.getElementById("video-camera-test");
        this.cameraVideoBox = document.getElementById("video-camera-test-box");
        this.cameraTestStream = null;
        this.cameraTest.addEventListener("click", async () => {
            if (this.cameraTestStream !== null) {
                this.stopCam();
                return;
            }

            const deviceId = this.cameraSelect.value;
            const stream = await navigator.mediaDevices.getUserMedia({"video": {"deviceId": deviceId}});

            this.cameraVideo.srcObject = stream;
            this.cameraTestStream = stream;
            this.cameraVideoBox.classList.remove("hide");
            this.cameraTest.children[0].innerText = "pause";
        });

        // screen test: the whole of the host's pipeline into a decoder on this
        // machine, through ctx["stream"] - the one encoder line in the tree.
        // In a browser it is the screen picker and WebCodecs; under the desktop
        // shell, ffmpeg on the display chosen here.
        this.displaySelect = document.getElementById("select-display-input");
        this.displayRefresh = document.getElementById("btn-display-refresh");
        this.displayTest = document.getElementById("btn-display-test");
        this.displayCanvas = document.getElementById("video-display-test");
        this.displayVideoBox = document.getElementById("video-display-test-box");
        this.isPreviewing = false;
        if (desktop.isAvailable) {
            this.displayRefresh.addEventListener("click", () => {
                this.listDisplay();
            });
            this.listDisplay();
        } else {
            this.displayRefresh.parentElement.classList.add("hide");

            const select = this.displaySelect;
            for (let i = select.options.length-1; i > -1; i--) {
                select.remove(i);
            }
            this.displaySelect.disabled = true;
            const option = new Option(localization.get("settings.video.display.notsupported"), "");
            this.displaySelect.add(option);
            if (ctx["stream"].isShareSupported() === false) {
                this.displayTest.disabled = true;
            }
        }
        this.displayTest.addEventListener("click", async () => {
            if (this.isPreviewing === true) {
                this.stopDisplay();
                return;
            }
            try {
                const screenIndex = Number(this.displaySelect.value);
                await ctx["stream"].preview(this.displayCanvas, {"screenIndex": (Number.isInteger(screenIndex) ? screenIndex : undefined)});
            } catch (error) {
                console.error("Cannot preview the screen:", error);
                ctx["ui"].snackbar.show(String(error?.message ?? error), true);
                return;
            }
            this.isPreviewing = true;
            this.displayVideoBox.classList.remove("hide");
            this.displayTest.children[0].innerText = "pause";
        });
        // the picker's own stop button, or the encoder giving up, ends it too
        ctx["stream"].addEventListener("stopped", (event) => {
            if (event.detail?.["role"] === "preview") {
                this.stopDisplay();
            }
        });
    };

    async listCam() {
        // list video input devices
        const selectedDevices = await listDevices("videoinput");
        const localization = this.ctx["localization"];

        // remove all old options
        const select = this.cameraSelect;
        for (let i = select.options.length-1; i > -1; i--) {
            select.remove(i);
        }

        // add new options
        if (selectedDevices.length === 0) {
            select.disabled = true;
            const option = new Option(localization.get("settings.video.cam.notfound"), "");
            select.add(option);
        } else {
            select.disabled = false;
            for (let device of selectedDevices) {
                const option = new Option(device.label || localization.get("settings.video.cam.name") + " " + select.options.length+1, device.deviceId);
                select.add(option);
            }
            select.dispatchEvent(new Event("change"));
        }
    };

    async listDisplay() {
        const localization = this.ctx["localization"];
        const screens = this.ctx["desktop"].Control.Screen.list();
        const select = this.displaySelect;

        // remove all old options
        for (let i = select.options.length-1; i > -1; i--) {
            select.remove(i);
        }

        if (screens.length === 0) {
            select.disabled = true;
            this.displayTest.disabled = true;
            select.add(new Option(localization.get("settings.video.display.notfound"), ""));
        } else {
            select.disabled = false;
            for (let i = 0; i < screens.length; i++) {
                select.add(new Option(localization.get("settings.video.display.name") + " " + (i+1), i));
            }
        }
        select.dispatchEvent(new Event("change"));
    };

    stopCam() {
        if (this.cameraTestStream === null) {
            return;
        }
        this.cameraVideo.srcObject = null;

        const tracks = this.cameraTestStream.getTracks();
        for (let track of tracks) {
            track.stop();
        }
        this.cameraTestStream = null;

        this.cameraVideoBox.classList.add("hide");
        this.cameraTest.children[0].innerText = "play_arrow";
    };
    async stopDisplay() {
        if (this.isPreviewing === false) {
            return;
        }
        this.isPreviewing = false;
        if (this.ctx["stream"].getRole() === "preview") {
            await this.ctx["stream"].stop();
        }
        this.displayVideoBox.classList.add("hide");
        this.displayTest.children[0].innerText = "play_arrow";
    };

    open(params) {
        super.open(params);
        this.listCam();
    };
    close() {
        super.close();
        this.stopCam();
        this.stopDisplay();
    };
};

export { VideoWindow };
export default VideoWindow;
