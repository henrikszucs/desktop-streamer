"use strict";

// what this client can play and record: the decoder it has, whether it can pick
// up the system audio, and a test for the speakers and the microphone

// first-party dependencies
import { Panel } from "../../../src/view.js";
import { listDevices } from "../media-devices.js";

const AudioWindow = class extends Panel {
    static id = "settings.audio";
    static mountPoint = "#settings-windows";
    static rootId = "settings-audio";

    async mount(ctx) {
        const desktop = ctx["desktop"];
        const browser = ctx["ui"].env.browser;

        // decoder support
        this.decoderAudioSupport = document.getElementById("decoder-audio-support");
        this.decoderAudioUnsupport = document.getElementById("decoder-audio-unsupport");
        if (typeof AudioDecoder !== "undefined") {
            this.decoderAudioSupport.classList.remove("hide");
        } else {
            this.decoderAudioUnsupport.classList.remove("hide");
        }

        // system audio share
        this.systemAudioSupport = document.getElementById("system-audio-support");
        this.systemAudioPartial = document.getElementById("system-audio-partial");
        this.systemAudioUnsupport = document.getElementById("system-audio-unsupport");
        if (desktop.isAvailable) {
            this.systemAudioSupport.classList.remove("hide");
        } else if (browser["isChrome"] || browser["isOpera"] || browser["isEdgeChromium"]) {
            this.systemAudioPartial.classList.remove("hide");
        } else {
            this.systemAudioUnsupport.classList.remove("hide");
        }

        // speaker test
        this.speakerSelect = document.getElementById("select-audio-test");
        this.speakerBtn = document.getElementById("btn-test-audio-test");
        this.speakerContext = null;
        this.speakerSource = null;
        this.speakerSelect.addEventListener("change", () => {
            this.speakerStop();
        });
        this.speakerBtn.addEventListener("click", async () => {
            if (this.speakerContext !== null) {
                this.speakerStop();
                return;
            }
            this.speakerBtn.children[0].innerText = "pause";

            const value = this.speakerSelect.value;
            let url;
            if (value === "0") {
                url = "/media/test1.mp3";
            } else if (value === "1") {
                url = "/media/test2.mp3";
            } else {
                url = "/media/test3.mp3";
            }

            const context = new AudioContext();
            const source = context.createBufferSource();

            this.speakerContext = context;
            this.speakerSource = source;

            const res = await fetch(url);
            const buffer = await res.arrayBuffer();
            const audioBuffer = await context.decodeAudioData(buffer);
            source.buffer = audioBuffer;
            source.connect(context.destination);
            source.start();
            source.onended = () => {
                this.speakerStop();
            };
        });

        // mic test
        this.micSelect = document.getElementById("select-audio-input");
        this.micRefresh = document.getElementById("btn-refresh-audio-input");
        this.micTest = document.getElementById("btn-test-audio-input");
        navigator.mediaDevices.addEventListener("devicechange", () => {
            this.listMic();
        });
        this.micRefresh.addEventListener("click", () => {
            this.listMic();
        });
        this.micSelect.addEventListener("change", (event) => {
            this.micTest.disabled = (event.target.value === "");
        });

        this.micTestContext = null;
        this.micTestStream = null;
        this.micTestInterval = -1;
        this.micTest.addEventListener("click", async () => {
            if (this.micTestContext !== null) {
                this.micStop();
                return;
            }

            const deviceId = this.micSelect.value;
            const stream = await navigator.mediaDevices.getUserMedia({"audio": {"deviceId": deviceId}});

            const audioCtx = new AudioContext();
            const analyser = audioCtx.createAnalyser();
            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);

            this.micTestContext = audioCtx;
            this.micTestStream = stream;

            analyser.fftSize = 32;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            this.micTestInterval = setInterval(() => {
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum = Math.max(dataArray[i]);
                }
                const avg = sum;
                if (avg > 50) {
                    this.micTest.children[0].innerText = "signal_cellular_alt";
                } else if (avg > 26) {
                    this.micTest.children[0].innerText = "signal_cellular_alt_2_bar";
                } else {
                    this.micTest.children[0].innerText = "signal_cellular_alt_1_bar";
                }
            }, 100);
        });
    };

    async listMic() {
        // list audio input devices
        const selectedDevices = await listDevices("audioinput");

        // remove all old options
        const select = this.micSelect;
        for (let i = select.options.length-1; i > -1; i--) {
            select.remove(i);
        }

        // add new options
        if (selectedDevices.length === 0) {
            select.disabled = true;
            const option = new Option(this.ctx["localization"].get("settings.audio.mic.notfound"), "");
            select.add(option);
        } else {
            select.disabled = false;
            for (let device of selectedDevices) {
                const option = new Option(device.label || `Microphone ${select.options.length+1}`, device.deviceId);
                select.add(option);
            }
            select.dispatchEvent(new Event("change"));
        }
    };

    speakerStop() {
        if (this.speakerContext === null) {
            return;
        }

        this.speakerSource.stop();
        this.speakerSource = null;
        this.speakerContext.close();
        this.speakerContext = null;

        this.speakerBtn.children[0].innerText = "play_arrow";
    };
    micStop() {
        if (this.micTestContext === null) {
            return;
        }

        this.micTestContext.close();
        this.micTestContext = null;

        const tracks = this.micTestStream.getTracks();
        for (let track of tracks) {
            track.stop();
        }
        this.micTestStream = null;

        clearInterval(this.micTestInterval);
        this.micTestInterval = -1;

        this.micTest.children[0].innerText = "play_arrow";
    };

    open(params) {
        super.open(params);
        this.listMic();
    };
    close() {
        super.close();
        this.speakerStop();
        this.micStop();
    };
};

export { AudioWindow };
export default AudioWindow;
