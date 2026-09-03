"use strict";

// the cameras and the screens: a preview for both, and under the desktop shell
// the screen preview goes through the same ffmpeg encoder and decoder a room
// would use

// third-party dependencies
import { Decoder } from "../../../../libs/ffmpeg-chunkifier/decoder.js";

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

        // screen test
        this.displaySelect = document.getElementById("select-display-input");
        this.displayRefresh = document.getElementById("btn-display-refresh");
        this.displayTest = document.getElementById("btn-display-test");
        this.displayVideo = document.getElementById("video-display-test");
        this.displayVideoBox = document.getElementById("video-display-test-box");
        this.displayTestStream = null;
        if (desktop.isAvailable) {
            this.displayRefresh.addEventListener("click", () => {
                this.listDisplay();
            });
            this.displayTest.addEventListener("click", async () => {
                if (this.displayTestStream !== null) {
                    this.stopDisplay();
                    return;
                }
                const screenIndex = Number(this.displaySelect.value);
                if (screenIndex < 0) {
                    return;
                }
                const trackGenerator = new MediaStreamTrackGenerator({ "kind": "video" });
                const writer = trackGenerator.writable.getWriter();
                const stream = new MediaStream([trackGenerator]);

                this.decoder = new Decoder();
                this.decoder.onVideoFrame = async (frame) => {
                    try {
                        await writer.write(frame);
                    } catch (e) {
                        console.error("Failed to write frame:", e);
                    } finally {
                        frame.close();
                    }
                };
                this.videoEncoderFFmpeg = new desktop["FFmpegVideoEncoder"]();
                this.videoEncoderFFmpeg.onConfiguration = (config) => {
                    this.decoder.appendVideoConfiguration(config);
                };
                this.videoEncoderFFmpeg.onChunk = (chunk) => {
                    this.decoder.appendVideoChunk(chunk);
                };
                this.videoEncoderFFmpeg.onEnd = (error) => {
                    console.log("Video encoding ended with error code:", error);
                };

                const ffpmegParams = [];
                ffpmegParams.push(
                    "-fflags", "+nobuffer+flush_packets",
                    "-flags", "+low_delay",
                    "-analyzeduration", "0",         // Don't analyze input
                    "-probesize", "32",              // Minimum probe size
                    "-thread_queue_size", "8"       // Small queue");
                );
                if (desktop["os"].platform() === "win32") {
                    ffpmegParams.push(
                        "-filter_complex",
                        "gfxcapture=monitor_idx=" + screenIndex +
                        ":capture_cursor=true" +
                        ":max_framerate=30" +
                        ",hwdownload,format=bgra",
                    );
                }
                ffpmegParams.push(
                    "-c:v", "h264_nvenc",
                    "-b:v", "10000K",
                    "-tune:v", "3",
                    "-profile:v", "2",
                    "-level:v", "51",
                    "-rc:v", "1",
                    "-rgb_mode:v", "1",
                    "-delay:v", "0",
                    "-zerolatency:v", "1",

                    "-framerate", "30",
                    "-g", "30",             // Keyframe interval (every 30 frames = 0.5s at 60fps)
                    "-keyint_min", "30",
                    "-force_key_frames", "expr:gte(t,n_forced*0.5)",
                    "-f", "mp4",
                    "-movflags", "frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset",
                    "-frag_duration", "16666",
                    "pipe:1"
                );
                await this.videoEncoderFFmpeg.start(
                    desktop["ffmpegPath"],
                    ffpmegParams,
                    {
                        "codec": "avc1.640033",
                        "codedWidth": 1920,
                        "codedHeight": 1080,
                        "hardwareAcceleration": "prefer-hardware",
                        "optimizeForLatency": true
                    }
                );
                this.displayVideo.srcObject = stream;
                this.displayTestStream = stream;
                stream.getVideoTracks()[0].addEventListener("ended", async () => {
                    this.stopDisplay();
                });

                this.displayVideoBox.classList.remove("hide");
                this.displayTest.children[0].innerText = "pause";
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

            this.displayTest.addEventListener("click", async () => {
                if (this.displayTestStream !== null) {
                    this.stopDisplay();
                    return;
                }
                const stream = await navigator.mediaDevices.getDisplayMedia({"video": true, "audio": false});

                this.displayVideo.srcObject = stream;
                this.displayTestStream = stream;
                stream.getVideoTracks()[0].addEventListener("ended", () => {
                    this.stopDisplay();
                });

                this.displayVideoBox.classList.remove("hide");
                this.displayTest.children[0].innerText = "pause";
            });
        }
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
        if (this.displayTestStream === null) {
            return;
        }
        this.displayVideo.srcObject = null;

        const tracks = this.displayTestStream.getTracks();
        for (let track of tracks) {
            track.stop();
        }
        this.displayTestStream = null;

        await this.videoEncoderFFmpeg?.end?.();
        await this.decoder?.end?.();

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
