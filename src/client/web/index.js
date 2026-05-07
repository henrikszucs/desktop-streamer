"use strict";


// import dependencies
import pako from "./libs/pako/pako.min.mjs";
import IDB from "./libs/idb/idb.js";
import Communicator from "./libs/communicator/communicator.js";
import {BrowserAudioEncoder} from "./libs/ffmpeg-chunkifier/encoder-browser.js";
import {Decoder, Player} from "./libs/ffmpeg-chunkifier/decoder.js";
import localization from "./localization.js";

// Configuration
// Task to load environment and essential data and desktop libs for the application.
const Environment = class {
    constructor() {
        this.DATABBASE_NAME = "desktop_streamer";
        this.CONF_TABLE = "configuration";
        // start DOM wait
        this.waitDOM = new Promise(function (resolve) {
            window.addEventListener("load", () => {
                resolve();
            }, { "once": true });
        });
        this.configuration = {};            // local configuration values
        this.desktop = {};                  // desktop specific APIs and libs
        this.server = {};                   // server configuration from conf.json
    };
    async load() {
        await this.loadDatabase();
        await this.loadConfJson();
        await this.loadDesktopLibs();
        await this.waitDOM;
    };
    async loadDatabase() {
        // database setup
        await IDB.TableSet(this.DATABBASE_NAME, this.CONF_TABLE);
        this.DB = await IDB.DatabaseGet(this.DATABBASE_NAME);
        const table = IDB.TableGet(this.DB, this.CONF_TABLE);

        // key and their default values
        const vals = {
            "color": "#006e1c",
            "mode": "auto",
            "lang": "auto",
            "autoLaunch": false,
            "minimizing": false,
            "exitShortcuts": "[]"
        };

        // load values from database
        const keys = Object.keys(vals);
        const search = [];
        for (let key of keys) {
            search.push([key, vals[key]]);
        }
        const res = await IDB.RowGet(table, search);
        const result = {};
        for (let i = 0, length = keys.length; i < length; i++) {
            result[keys[i]] = res[i];
        }

        this.configuration = result;
    };
    async loadConfJson() {
        let conf = await fetch("./conf.json");
        conf = await conf.json();
        this.server = conf;
    };
    async loadDesktopLibs() {
        let desktop = {};
        if (typeof require !== "undefined") {
            // load node modules
            const path = require("node:path");
            const os = require("node:os");
            const { spawn } = require("node:child_process");

            // load electron modules
            const { ipcRenderer } = require("electron");
            const appPath = await ipcRenderer.invoke("api", "path-app");
            const exePath = await ipcRenderer.invoke("api", "path-exe");

            // load desktop specific libs
            const AutoLaunch = require(path.join(appPath, "libs/auto-launch/auto-launch.js"));
            const Control = require(path.join(appPath, "libs/easy-control/easy-control.node"));
            const FFmpegEncoder = require(path.join(appPath, "libs/ffmpeg-chunkifier/encoder-ffmpeg.js"));

            // expose desktop APIs
            desktop.isAvailable = true;
            desktop.path = path;
            desktop.os = os;
            desktop.spawn = spawn;
            desktop.ipcRenderer = ipcRenderer;
            desktop.appPath = appPath;
            desktop.autoLaunch = new AutoLaunch({
                "name": "Desktop Streamer",
                "path": exePath
            });
            desktop.Control = Control;
            desktop.ffmpegPath = path.join(appPath, "libs/ffmpeg");
            desktop.FFmpegVideoEncoder = FFmpegEncoder["FFmpegVideoEncoder"];
            desktop.FFmpegAudioEncoder = FFmpegEncoder["FFmpegAudioEncoder"];

            // disable require to prevent security issues
            //globalThis.require = undefined; // disable require for security reasons
        } else {
            desktop.isAvailable = false;
        }
        console.log(desktop);
        this.desktop = desktop;

    };
    async setDatabaseValue(key, value) {
        const table = IDB.TableGet(this.DB, this.CONF_TABLE);
        await IDB.RowSet(table, [[key, value]]);
        this.configuration[key] = value;
    };
    
    checkBrowser() {
        // Opera 8.0+
        const isOpera = (!!window.opr && !!opr.addons) || !!window.opera || navigator.userAgent.indexOf(" OPR/") >= 0;

        // Firefox 1.0+
        const isFirefox = typeof InstallTrigger !== "undefined";

        // Safari 3.0+ "[object HTMLElementConstructor]" 
        const isSafari = /constructor/i.test(window.HTMLElement) || (function (p) { return p.toString() === "[object SafariRemoteNotification]"; })(!window["safari"] || (typeof safari !== "undefined" && window["safari"].pushNotification));

        // Internet Explorer 6-11
        const isIE = /*@cc_on!@*/false || !!document.documentMode;

        // Edge 20+
        const isEdge = !isIE && !!window.StyleMedia;

        // Chrome 1 - 79
        const isChrome = !!window.chrome;

        // Edge (based on chromium) detection
        const isEdgeChromium = isChrome && (navigator.userAgent.indexOf("Edg") != -1);

        // Blink engine detection
        const isBlink = (isChrome || isOpera) && !!window.CSS;

        return {
            "isFirefox": isFirefox,
            "isChrome": isChrome,
            "isSafari": isSafari,
            "isOpera": isOpera,
            "isIE": isIE,
            "isEdge": isEdge,
            "isEdgeChromium": isEdgeChromium,
            "isBlink": isBlink
        };
    };
    checkBrowser2() {
        const ua = navigator.userAgent;
        let tem; 
        let M = ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || [];
        if (/trident/i.test(M[1])) {
            tem = /\brv[ :]+(\d+)/g.exec(ua) || [];
            return "IE " + (tem[1] || "");
        }
        if (M[1] === "Chrome") {
            tem = ua.match(/\b(OPR|Edge)\/(\d+)/);
            if (tem != null) {
                return tem.slice(1).join(" ").replace("OPR", "Opera");
            }
        }
        M = M[2]? [M[1], M[2]]: [navigator.appName, navigator.appVersion, "-?"];
        if ((tem = ua.match(/version\/(\d+)/i))!= null) { 
            M.splice(1, 1, tem[1]);
        }
        return M;
    };
    getOS() {
        const userAgent = window.navigator.userAgent,
            platform = window.navigator?.userAgentData?.platform || window.navigator.platform,
            macosPlatforms = ["macOS", "Macintosh", "MacIntel", "MacPPC", "Mac68K"],
            windowsPlatforms = ["Win32", "Win64", "Windows", "WinCE"],
            iosPlatforms = ["iPhone", "iPad", "iPod"];
        let os = null;

        if (macosPlatforms.indexOf(platform) !== -1) {
            os = "darwin";
        } else if (iosPlatforms.indexOf(platform) !== -1) {
            os = "ios";
        } else if (windowsPlatforms.indexOf(platform) !== -1) {
            os = "win32";
        } else if (/Android/.test(userAgent)) {
            os = "android";
        } else if (/Linux/.test(platform)) {
            os = "linux";
        }

        return os;
    };
    getArch() {
        const ua = window.navigator.userAgent.toLowerCase();
        
        if (ua.includes("arm64") || ua.includes("aarch64")) {
            return "arm64";
        }
        if (ua.includes("arm")) {
            return "arm32";
        }
        if (ua.includes("x64") || ua.includes("win64") || ua.includes("x86_64")) {
            return "x64";
        }
        
        // Default to a 32-bit architecture if no 64-bit or ARM features are found
        return "x86";
    };
};
const environment = new Environment();
globalThis.environment = environment;

// Server
const WebRTCTransport = class extends EventTarget {
    constructor(server, offer) {
        super();
        this.server = server;
        this.isOpen = false;

        this.pc = null;
        if (offer === undefined) {
            this.startFunction = this.startHost();
        } else {
            this.startFunction = this.startPeer(offer);
        }
    };

    async startHost() {
        // open connection
        this.pc = new RTCPeerConnection(this.server.webRTCConfig);
        this.pc.addEventListener("icecandidate", this.onIceCandidate);
        this.pc.addEventListener("connectionstatechange", this.onConnectionStateChange);
        this.addEventListener("ice-candidate", this.onIceCandidateIncoming);

        await new Promise(async (resolve) => {
            // data channel open
            let openedChannels = 0;
            const openChannel = () => {
                openedChannels++;
                if (openedChannels === 6) {
                    console.log("All channels opened");
                    resolve();
                }
            };
            this.openDataChannel("system", 0, openChannel);
            this.openDataChannel("video", 1, openChannel);
            this.openDataChannel("audio", 2, openChannel);
            this.openDataChannel("icon", 3, openChannel);
            this.openDataChannel("mouse", 4, openChannel);
            this.openDataChannel("keyboard", 5, openChannel);
            

            // wait answer
            const handler = async (event) => {
                const remoteDesc = new RTCSessionDescription(event.detail);
                await this.pc.setRemoteDescription(remoteDesc);

                this.removeEventListener("answer", handler);
            };
            this.addEventListener("answer", handler);

            // send offer
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            this.server.communicator.invoke({
                "type": "join-request",
                "value": {
                    "type": "offer",
                    "value": offer
                }
            });
        });

        this.audioEncoderBrowser = new BrowserAudioEncoder();
        this.videoEncoderFFmpeg = new environment.desktop.FFmpegVideoEncoder();
        this.isOpen = true;
        this.dispatchEvent(new CustomEvent("open"));

        // setup communication
        this["systemCommunicator"].onIncoming(async (messageObj) => {
            await messageObj.wait();
            if (messageObj.data["type"] === "set-video") {
                const videoSettings = messageObj.data["value"];
                console.log("Received video settings:", videoSettings);
                let bitrate = videoSettings["bitrate"];
                if (bitrate === "0") {
                    bitrate = "1M";
                } else if (bitrate === "1") {
                    bitrate = "5M";
                } else if (bitrate === "2") {
                    bitrate = "10M";
                } else if (bitrate === "3") {
                    bitrate = "15M";
                } else if (bitrate === "4") {
                    bitrate = "20M";
                } else if (bitrate === "5") {
                    bitrate = "30M";
                } else {
                    bitrate = "40M";
                }
                let framerate = videoSettings["framerate"];
                if (framerate === "0") {
                    framerate = "15";
                } else if (framerate === "1") {
                    framerate = "30";
                } else {
                    framerate = "60";
                }
                let resolution = videoSettings["resolution"];
                let width, height;
                if (resolution === "0") {
                    width = 640;
                    height = 360;
                } else if (resolution === "1") {
                    width = 854;
                    height = 480;
                } else if (resolution === "2") {
                    width = 1280;
                    height = 720;
                } else {
                    width = 1920;
                    height = 1080;
                }

                await this.videoEncoderFFmpeg.end();
                const ctx = document.getElementById("room-video").getContext("webgpu");
                const player = new Player(false, null, ctx);
                const decoder = new Decoder();
                decoder.onVideoFrame = (frame) => {
                    player.appendVideoFrame(frame);
                };
                this.videoEncoderFFmpeg.onConfiguration = (config) => {
                    //console.log("Video configuration:", config);
                    decoder.appendVideoConfiguration(config);
                    config["description"] = config["description"].toBase64();
                    this["systemCommunicator"].send({
                        "type": "video-configuration",
                        "value": config
                    });
                };
                this.videoEncoderFFmpeg.onChunk = (chunk) => {
                    decoder.appendVideoChunk(chunk);
                    //console.log("Video chunk:", chunk);

                    const chunkAsBinary = new Uint8Array(1 + 4 + 4 + chunk.byteLength);
                    const view = new DataView(chunkAsBinary.buffer);
                    if (chunk.type === "key") {
                        view.setUint8(0, 0);
                    } else {
                        view.setUint8(0, 1);
                    }
                    view.setUint32(1, chunk.timestamp, true);
                    view.setUint32(5, chunk.duration, true);
                    const chunkBuffer = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(chunkBuffer);
                    chunkAsBinary.set(chunkBuffer, 9);

                    //console.log("Chunk as binary:", chunkAsBinary);
                    
                    this["videoCommunicator"].send(chunkAsBinary.buffer);
                };
                this.videoEncoderFFmpeg.onEnd = (error) => {
                    console.log("Video encoding ended with error code:", error);
                };

                await this.videoEncoderFFmpeg.start(
                    environment.desktop.ffmpegPath,
                    [
                        "-fflags", "+nobuffer+flush_packets",
                        "-flags", "+low_delay",
                        "-analyzeduration", "0",         // Don't analyze input
                        "-probesize", "32",              // Minimum probe size
                        "-thread_queue_size", "8",       // Small queue"

                        "-filter_complex",
                        "gfxcapture=monitor_idx=0" +
                        ":capture_cursor=false" +
                        ":max_framerate=" + framerate +
                        ",hwdownload,format=bgra," +
                        "scale=" + width + ":" + height,

                        "-c:v", "h264_nvenc",
                        "-b:v", bitrate,
                        "-tune:v", "3",
                        "-profile:v", "2",
                        "-level:v", "51",
                        "-rc:v", "1",
                        "-rgb_mode:v", "1",
                        "-delay:v", "0",
                        "-zerolatency:v", "1",
                        
                        "-framerate", framerate,
                        "-g", "30",             // Keyframe interval (every 30 frames = 0.5s at 60fps)
                        "-keyint_min", "30",
                        "-force_key_frames", "expr:gte(t,n_forced*0.5)",
                        "-f", "mp4",
                        "-movflags", "frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset",
                        "-frag_duration", "16666",
                        "pipe:1"
                    ],
                    {
                        "codec": "avc1.640033",
                        "codedWidth": width,
                        "codedHeight": height,
                        "hardwareAcceleration": "prefer-hardware",
                        "optimizeForLatency": true
                    }
                );

                // start mouse icon
                clearInterval(this.iconInterval);
                this.iconData = [];
                this.iconInterval = setInterval(async () => {
                    const icon = environment.desktop.Control.Mouse.getIcon();
                    
                    const data = icon["data"];
                    
                    // ignore if same as previous
                    if (this.iconData.length === data.length && this.iconData.every((value, index) => value === data[index])) {
                        return;
                    }
                    // send icon data
                    //console.log("Mouse icon:", icon);
                    const xOffset = icon["xOffset"];
                    const yOffset = icon["yOffset"];
                    const width = icon["width"];
                    const height = icon["height"];
                    const scaleFactor = environment.desktop.Control.Screen.list()[0]["scaleFactor"]; 
                    this.iconData = data;
                    const iconAsBinary = new Uint8Array(4 + 4 + 4 + 4 + 4 + icon.data.length);
                    const view = new DataView(iconAsBinary.buffer);
                    view.setUint32(0, icon.width);
                    view.setUint32(4, icon.height);
                    view.setInt32(8, icon.xOffset);
                    view.setInt32(12, icon.yOffset);
                    view.setFloat32(16, scaleFactor);
                    const iconBuffer = new Uint8Array(data);
                    iconAsBinary.set(iconBuffer, 20);
                    const compressed = pako.deflate(iconAsBinary);
                    //console.log("Compressed icon size:", compressed.byteLength);
                    this["iconCommunicator"].send(compressed.buffer);
                }, 1000 / 25);

                // test latency on system channel
                let test = null;
                test = async () => {
                    const startTime = Date.now();
                    const MB = 10;
                    const data = new ArrayBuffer(1048576*MB);
                    const msg = this["audioCommunicator"].send(data);
                    await msg.wait();
                    const endTime = Date.now();
                    console.log("Round-trip latency for "+MB+"MB message:", endTime - startTime, "ms");
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    test();
                };

            } else if (messageObj.data["type"] === "set-audio") {
                const audioSettings = messageObj.data["value"];
                console.log("Received video settings:", audioSettings);
                let mute = audioSettings["mute"];



                // audio setup
                await this.audioEncoderBrowser.end();
                if (mute === "1") {
                    return;
                }
                this.audioEncoderBrowser.onConfiguration = (config) => {
                    console.log("Audio configuration:", config);
                    config["description"] = new Uint8Array(config["description"]).toBase64();
                    this["systemCommunicator"].send({
                        "type": "audio-configuration",
                        "value": config
                    });
                };
                this.audioEncoderBrowser.onChunk = (chunk) => {
                    //console.log("Audio chunk:", chunk);
                    const chunkAsBinary = new Uint8Array(1 + 4 + 4 + chunk.byteLength);
                    const view = new DataView(chunkAsBinary.buffer);
                    if (chunk.type === "key") {
                        view.setUint8(0, 0);
                    } else {
                        view.setUint8(0, 1);
                    }
                    view.setUint32(1, chunk.timestamp, true);
                    view.setUint32(5, chunk.duration, true);
                    const chunkBuffer = new Uint8Array(chunk.byteLength);
                    chunk.copyTo(chunkBuffer);
                    chunkAsBinary.set(chunkBuffer, 9);

                    //console.log("Chunk as binary:", chunkAsBinary);

                    this["audioCommunicator"].send(chunkAsBinary.buffer);
                };
                this.audioEncoderBrowser.onEnd = (error) => {
                    console.log("Audio encoding ended with error code:", error);
                };
                await this.audioEncoderBrowser.start({
                    "codec": "mp4a.40.2",
                    "sampleRate": 48000,
                    "numberOfChannels": 2
                });
            }
        });

        const display = environment.desktop.Control.Screen.list()[0];
        const fullscreenWidth = display["width"] * display["scaleFactor"];
        const fullscreenHeight = display["height"] * display["scaleFactor"];

        this["mouseCommunicator"].onIncoming(async (messageObj) => {
            await messageObj.wait();
            const data = messageObj.data;
            if (typeof data["x"] === "number") {
                environment.desktop.Control.Mouse.setX(data["x"] * fullscreenWidth);
            }
            if (typeof data["y"] === "number") {
                environment.desktop.Control.Mouse.setY(data["y"] * fullscreenHeight);
            }
            if (typeof data["button"] === "object") {
                const key = data["button"]["key"];
                const state = data["button"]["state"];
                if (state === "down") {
                    environment.desktop.Control.Mouse.buttonDown(key);
                } else if (state === "up") {
                    environment.desktop.Control.Mouse.buttonUp(key);
                }
            }
            if (typeof data["wheel"] === "object") {
                const direction = data["wheel"]["direction"];
                const amount = data["wheel"]["amount"];
                if (direction === "up") {
                    environment.desktop.Control.Mouse.scrollUp(amount, false);
                } else if (direction === "down") {
                    environment.desktop.Control.Mouse.scrollDown(amount, false);
                } else if (direction === "left") {
                    environment.desktop.Control.Mouse.scrollUp(amount, true);
                } else if (direction === "right") {
                    environment.desktop.Control.Mouse.scrollDown(amount, true);
                }
            }
        });

        this["keyboardCommunicator"].onIncoming(async (messageObj) => {
            await messageObj.wait();
            const data = messageObj.data;
            if (typeof data["key"] === "object") {
                const key = data["key"]["key"];
                const state = data["key"]["state"];
                if (state === "up") {
                    environment.desktop.Control.Keyboard.keyUp(key);
                } else if (state === "down") {
                    environment.desktop.Control.Keyboard.keyDown(key);
                }
            }
        });
    };

    async startPeer(offer) {
        // open connection
        this.pc = new RTCPeerConnection(this.server.webRTCConfig);
        this.pc.addEventListener("icecandidate", this.onIceCandidate);
        this.pc.addEventListener("connectionstatechange", this.onConnectionStateChange);
        this.addEventListener("ice-candidate", this.onIceCandidateIncoming);
        
        
        await new Promise(async (resolve) => {
            // data channel open
            let openedChannels = 0;
            const openChannel = () => {
                openedChannels++;
                if (openedChannels === 6) {
                    console.log("All channels opened");
                    resolve();
                }
            };
            this.openDataChannel("system", 0, openChannel);
            this.openDataChannel("video", 1, openChannel);
            this.openDataChannel("audio", 2, openChannel);
            this.openDataChannel("icon", 3, openChannel);
            this.openDataChannel("mouse", 4, openChannel);
            this.openDataChannel("keyboard", 5, openChannel);

            // set offer
            const offerDesc = new RTCSessionDescription(offer);
            await this.pc.setRemoteDescription(offerDesc);

            // create and send answer
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.server.communicator.invoke({
                "type": "join-request",
                "value": {
                    "type": "answer",
                    "value": answer
                }
            });
        });

        this.isOpen = true;
        this.dispatchEvent(new CustomEvent("open"));

        this["systemCommunicator"].onIncoming(async (messageObj) => {
            await messageObj.wait();
            const data = messageObj.data;
            if (data["type"] === "video-configuration") {
                data["value"]["description"] = Uint8Array.fromBase64(data["value"]["description"]);
                console.log(data["value"]);
                this.decoder.appendVideoConfiguration(data["value"]);
            } else if (data["type"] === "audio-configuration") {
                data["value"]["description"] = Uint8Array.fromBase64(data["value"]["description"]).buffer;
                console.log(data["value"]);
                this.decoder.appendAudioConfiguration(data["value"]);
            }
        });

        this["videoCommunicator"].onIncoming(async (messageObj) => {
            await messageObj.wait();
            const data = messageObj.data;
            //console.log("Received video chunk:", data);
            const view = new DataView(data);
            const type = view.getUint8(0) === 0 ? "key" : "delta";
            const timestamp = view.getUint32(1);
            const duration = view.getUint32(5);
            const chunkData = new Uint8Array(data, 9);

            const chunk = new EncodedVideoChunk({
                "type": type,
                "timestamp": timestamp,
                "duration": duration,
                "data": chunkData,
                "trandsfer": [chunkData.buffer]
            });

            this.decoder.appendVideoChunk(chunk);
        });

        this["audioCommunicator"].onIncoming(async (messageObj) => {
            await messageObj.wait();
            const data = messageObj.data;
            //console.log("Received audio chunk:", data);
            const view = new DataView(data);
            const type = view.getUint8(0) === 0 ? "key" : "delta";
            const timestamp = view.getUint32(1);
            const duration = view.getUint32(5);
            const chunkData = new Uint8Array(data, 9);

            const chunk = new EncodedAudioChunk({
                "type": type,
                "timestamp": timestamp,
                "duration": duration,
                "data": chunkData,
                "trandsfer": [chunkData.buffer]
            });
            this.decoder.appendAudioChunk(chunk);
        });

        this["iconCommunicator"].onIncoming(async (messageObj) => {
            await messageObj.wait();
            const data = messageObj.data;
            const decompressed = pako.inflate(new Uint8Array(data));
            const view = new DataView(decompressed.buffer);
            const width = view.getUint32(0);
            const height = view.getUint32(4);
            const xOffset = view.getInt32(8);
            const yOffset = view.getInt32(12);
            const scaleFactor = view.getFloat32(16);
            const iconData = new Uint8Array(decompressed.buffer, 20);
            this.icon = {
                "width": width,
                "height": height,
                "xOffset": xOffset,
                "yOffset": yOffset,
                "scaleFactor": scaleFactor,
                "data": iconData
            };
            //console.log("Received mouse icon:", this.icon);
            this.dispatchEvent(
                new CustomEvent("icon", {
                    "detail": this.icon
                }
            ));
        });
    };

    onIceCandidate = async (event) => {
        const messageObj = this.server.communicator.invoke({
            "type": "join-request",
            "value": {
                "type": "iceCandidate",
                "value": event.candidate
            }
        });
        await messageObj.wait();
    };

    onConnectionStateChange = (event) => {
        console.log("connectionstatechange:", this.pc.connectionState);
        if (this.pc.connectionState === "connected") {
                    
        } else if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed" || this.pc.connectionState === "disconnected") {
            this.close();
        }
    };

    onIceCandidateIncoming = async (event) => {
        try {
            await this.pc.addIceCandidate(event.detail);
        } catch(err) {
            console.log("Error adding received ICE candidate:", err);
        }
    };

    addDataRequest = (data) => {
        const type = data["type"];
        const value = data["value"];
        if (type === "iceCandidate") {
            this.dispatchEvent(new CustomEvent("ice-candidate", {
                "detail": value
            }));
        } else if (type === "offer") {
            this.dispatchEvent(new CustomEvent("offer", {
                "detail": value
            }));
        } else if (type === "answer") {
            this.dispatchEvent(new CustomEvent("answer", {
                "detail": value
            }));
        }
    };

    openDataChannel = (label, id, cb) => {
        const channel = this.pc.createDataChannel(label, {
            "ordered": false,
            "maxPacketLifeTime": 500,
            "negotiated": true,
            "id": id
        });
        channel.binaryType = "arraybuffer";
        channel.addEventListener("open", async () => {
            console.log(`${label} - Data channel opened`);
            await communicator.sideSync();
            await communicator.timeSync();
            cb(channel);
        }, { "once": true });

        const communicator = new Communicator({
            "sender": function() {},
            "interactTimeout": 2000,    //the max timeout between two packet arrive
            "timeout": 3000,            //the time for transmit message
            "packetSize": 16383,        //the maximum size of one packet in bytes (only for ArrayBuffer)
            "packetTimeout": 500,       //the max timeout for packets
            "packetRetry": Infinity,    //number of retring attemts for one packet
            "sendThreads": 16
        });
        communicator.configure({
            "sender": (data) => {
                if ((data instanceof ArrayBuffer) === false) {
                    data = JSON.stringify(data);
                }
                channel.send(data);
            }
        });
        channel.addEventListener("message", (event) => {
            let data = event.data;
            //console.log(data);
            if (typeof data === "string") {
                data = JSON.parse(data);
            }
            
            communicator.receive(data);
        });

        this[`${label}Channel`] = channel;
        this[`${label}Communicator`] = communicator;
    };

    close() {
        this.systemChannel?.close?.();
        this.videoChannel?.close?.();
        this.audioChannel?.close?.();
        this.mouseChannel?.close?.();
        this.keyboardChannel?.close?.();
        this.iconChannel?.close?.();
        this.pc.close();

        this?.videoEncoderFFmpeg?.end();
        this?.audioEncoderBrowser?.end();
        clearInterval(this.iconInterval);
        this.iconInterval = -1;

        this.isOpen = false;
        this.dispatchEvent(new CustomEvent("close"));
    };

    async wait() {
        await this.startFunction;
    };

    setVideo(bitrate, framerate, resolution, outCanvas) {
        const ctx = outCanvas.getContext("webgpu");
        const player = new Player(true, null, ctx);
        this.decoder = new Decoder();
        this.decoder.onVideoFrame = (frame) => {
            player.appendVideoFrame(frame);
        };
        this.decoder.onAudioFrame = (frame) => {
            player.appendAudioFrame(frame);
        };
        this["systemCommunicator"].send({
            "type": "set-video",
            "value": {
                "bitrate": bitrate,
                "framerate": framerate,
                "resolution": resolution
            }
        });
    };

    setAudio(mute="0") {
        this["systemCommunicator"].send({
            "type": "set-audio",
            "value": {
                "mute": mute
            }
        });
    };

    setMousePos(x, y) {
        this["mouseCommunicator"].send({
            "x": x,
            "y": y
        });
    };
    setMouseButton(button, state) {
        this["mouseCommunicator"].send({
            "button": {
                "key": button,
                "state": state
            }
        });
    };
    setMouseWheel(direction, amount) {
        this["mouseCommunicator"].send({
            "wheel": {
                "direction": direction,
                "amount": amount
            }
        });
    };
    setKeyboard(key, state) {
        this["keyboardCommunicator"].send({
            "key": {
                "key": key,
                "state": state
            }
        });
    };
};

// Handle API calls with WebSocket backend and WebRTC connection
const Server = class extends EventTarget {
    constructor() {
        super();
        this.address = "";
        this.communicator = null;
        this.isOnline = false;
        this.ws = null;

        this.webRTCConfig = {};
        this.joinId = "";
        this.peerCode = "";
        this.hostCode = "";
        this.webRTC = null;
    };
    async load(address, webRTCConfig={}) {
        this.address = address;
        this.webRTCConfig = webRTCConfig;
        this.communicator = new Communicator({
            "sender": function() {},
            "interactTimeout": 3000,    //the max timeout between two packet arrive
            "timeout": 5000,            //the time for transmit message
            "packetSize": 1000,         //the maximum size of one packet in bytes (only for ArrayBuffer)
            "packetTimeout": 1000,      //the max timeout for packets
            "packetRetry": Infinity,    //number of retring attemts for one packet
            "sendThreads": 16
        });

        // configure sender fn
        this.communicator.configure({
            "sender": this.senderHandle,
        });

        // listen for incoming requests
        this.communicator.onIncoming(this.handleIncoming);

        this.connect();

        return new Promise((resolve) => {
            this.addEventListener("online", resolve, {"once": true});
        });
    };
    connect() {
        // close existing connection if exists
        this.ws?.close?.();
        
        //create connection
        console.log(this.address);
        this.ws = new WebSocket(this.address);
        this.ws.binaryType = "arraybuffer";

        // configure receiver fn
        this.ws.addEventListener("message", this.receiverHandle);

        // connection finishing
        this.ws.addEventListener("open", this.connectHandle, { "once": true });

        // connection error handling
        this.ws.addEventListener("error", this.wsErorHandle);

        // connection close handling
        this.ws.addEventListener("close", this.wsCloseHandle);
    };
    connectHandle = async () => {
        // sync
        await this.communicator.sideSync();
        await this.communicator.timeSync();

        //trigger online event
        this.isOnline = true;
        this.dispatchEvent(new CustomEvent("online"));

        console.log("connected");
    };
    disconnectHandle() {
        this.ws.removeEventListener("open", this.connectHandle);
        this.ws.removeEventListener("error", this.wsErorHandle);
        this.ws.removeEventListener("close", this.wsCloseHandle);
        this.isOnline = false;
        this.dispatchEvent(new CustomEvent("offline"));
        setTimeout(() => {
            this.connect();
        }, 2000);
    };
    wsErorHandle = () => {
        console.log("error");
        this.disconnectHandle();
    };
    wsCloseHandle = () => {
        console.log("close");
        this.disconnectHandle();
    };

    senderHandle = (data) => {
        if ((data instanceof ArrayBuffer) === false) {
            data = JSON.stringify(data);
        }
        this.ws.send(data);
    };
    receiverHandle = (event) => {
        console.log("Received data:", event.data);
        let data = event.data;
        if (typeof data === "string") {
            data = JSON.parse(data);
        }
        this.communicator.receive(data);
    };


    handleIncoming = async (messageObj) => {
        await messageObj.wait();
        const message = messageObj.data;

        // pair request (host)
        if (message["type"] === "pair-request") {
            this.dispatchEvent(new CustomEvent("pair-request", {
                "detail": {
                    "ip": message["ip"],
                    "timeout": message["timeout"]
                }
            }));
            return;
        }

        // pair reject
        if (message["type"] === "pair-reject") {
            this.dispatchEvent(new CustomEvent("pair-reject"));
            return;
        }

        // pair accept (peer)
        if (message["type"] === "pair-accept") {
            this.joinId = message["joinId"];
            this.peerCode = message["peerCode"];

            this.dispatchEvent(new CustomEvent("pair-accept"));
            return;
        }

        // join
        if (message["type"] === "join-connect") {
            this.dispatchEvent(new CustomEvent("join-connect"));
            return;
        }

        if (message["type"] === "join-disconnect") {
            this.dispatchEvent(new CustomEvent("join-disconnect"));
            this.webRTC?.close?.();
            return;
        }

        if (message["type"] === "join-delete") {
            this.webRTC?.close?.();
            this.dispatchEvent(new CustomEvent("join-delete"));
            return;
        }

        if (message["type"] === "join-request") {
            // create webRTC connection
            console.log("Received join request");
            console.log(message["value"]);
            if (message["value"]["type"] === "offer") {
                this.webRTC = new WebRTCTransport(this, message["value"]["value"]);
                await this.webRTC.wait();
                this.dispatchEvent(new CustomEvent("join-request"));
                return;
            }
            this.webRTC.addDataRequest(message["value"]);
            return;
        }

    };

    // pairing
    async pairCreate() {
        const msg = this.communicator.invoke({
            "type": "pair-create"
        });
        await msg.wait();
        const data = msg.data;
        if (!data["success"]) {
            throw new Error("Failed to create pair");
        }
        return data["pairCode"];
    };
    async pairRequest(pairCode) {
        const msg = this.communicator.invoke({
            "type": "pair-request",
            "pairCode": pairCode
        });
        await msg.wait();
        const data = msg.data;
        if (!data["success"]) {
            throw new Error("Failed to request pair");
        }
        return data;
    };
    async pairAccept() {
        const msg = this.communicator.invoke({
            "type": "pair-accept"
        });
        await msg.wait();
        const data = msg.data;
        if (!data["success"]) {
            throw new Error("Failed to request pair");
        }
        this.joinId = data["joinId"];
        this.hostCode = data["hostCode"];
        return;
    };
    async pairReject() {
        const msg = this.communicator.invoke({
            "type": "pair-reject"
        });
        await msg.wait();
        const data = msg.data;
        if (!data["success"]) {
            throw new Error("Failed to request pair");
        }
        return true;
    };
    async pairDelete() {
        const msg = this.communicator.invoke({
            "type": "pair-delete"
        });
        await msg.wait();
        const data = msg.data;
        if (!data["success"]) {
            throw new Error("Failed to request pair");
        }
        return true;
    };

    // joining
    async joinConnect() {
        if (this.joinId === undefined) {
            throw new Error("joinId is required");
        }
        if (this.peerCode === undefined && this.hostCode === undefined) {
            throw new Error("Either peerCode or hostCode is required");
        }
        const startMsg = {
            "type": "join-connect",
            "joinId": this.joinId,
        };
        if (this.peerCode !== undefined) {
            startMsg["peerCode"] = this.peerCode;
        } else if (this.hostCode !== undefined) {
            startMsg["hostCode"] = this.hostCode;
        }
        const msg = this.communicator.invoke(startMsg);
        await msg.wait();
        if (!msg.data["success"]) {
            throw new Error("Failed to connect join");
        }
        return;
    };
    async joinRequest() {
        this.webRTC = new WebRTCTransport(this);
        await this.webRTC.wait();
    };
    async joinDisconnect() {
        if (this.joinId === undefined) {
            throw new Error("joinId is required");
        }
        const joinId = this.joinId;
        const msg = this.communicator.invoke({
            "type": "join-disconnect",
            "joinId": joinId
        });
        await msg.wait();
        this.webRTC?.close?.();
        this.joinId = "";
        this.peerCode = "";
        this.hostCode = "";
        this.webRTC = null;
    };
};
const server = new Server();
globalThis.server = server;

// Image enchanter (Native WebGPU with Zero PCIe Copy Overhead)
const Enchanter = class {
    constructor() {
        this.isAvailable = false;
        this.model = null;
    };
    
    async loadModels() {
        console.log("Native WebGPU upscaler initialized (tf.browser.draw)");
        await tf.setBackend("webgpu");
        await tf.ready();
        this.model = await tf.loadGraphModel("/models/upscaler/model.json");
        this.upscalerModel = await tf.loadGraphModel("/models/upscaler/model.json");
        this.framegenModel = await tf.loadGraphModel("/models/framegen/model.json");
        this.framegenModel2 = await tf.loadGraphModel("/models/framegen2/model.json");
        this.isAvailable = true;
        this.frameCounter2 = 0;
        this.frameCounter3 = 0;
        setInterval(async () => {
            if (this.frameCounter) {
                const fps2 = this.frameCounter2;
                const fps3 = this.frameCounter3;
                await new Promise((resolve) => setTimeout(resolve, 1000));
                console.log("FPS real:", this.frameCounter2 - fps2);
                console.log("FPS predict:", this.frameCounter3 - fps3);
            }
        }, 2000);
    };

    async drawTensorToCanvas(tensorToDraw, targetCanvas) {
        try {
            // 1. THE BARRIER: Force WebGPU to finish all math and flush the queue.
            // The script physically stops here until the GPU is 100% done.
            const rawData = await tensorToDraw.data(); 

            // 2. Extract dimensions
            const [height, width] = tensorToDraw.shape;
            
            // 3. Paint to the canvas
            // Note: If you are strictly using canvas.getContext('webgpu'), 
            // see the critical warning below this code block.
            const ctx = targetCanvas.getContext('2d');
            targetCanvas.width = width;
            targetCanvas.height = height;
            const imageData = new ImageData(width, height);
            const pixelData = imageData.data;

            for (let i = 0, j = 0; i < rawData.length; i += 3, j += 4) {
                pixelData[j]     = rawData[i];       // R
                pixelData[j + 1] = rawData[i + 1];   // G
                pixelData[j + 2] = rawData[i + 2];   // B
                pixelData[j + 3] = 255;              // A
            }

            // This operation is synchronous and paints the screen instantly
            ctx.putImageData(imageData, 0, 0);

        } catch (err) {
            console.error("Strict Draw Failed:", err);
        }
    };

    async copyCanvas(inCanvas, outCanvas) {
        // Yield CPU thread to prevent UI freezing
        await tf.nextFrame();

        // Read pixels from the input canvas directly into a tensor
        const tensor = tf.tidy(() => {
            return tf.browser.fromPixels(inCanvas);
        });

        // Use the native WebGPU tf.browser.draw function to blast pixels straight to the output
        //await this.drawTensorToCanvas(tensor, outCanvas);
        await tf.browser.draw(tensor, outCanvas);
        
        // Manual tensor cleanup
        tensor.dispose();

        return;
        // Match dimensions if needed
        if (outCanvas.width !== inCanvas.width || outCanvas.height !== inCanvas.height) {
            outCanvas.width = inCanvas.width;
            outCanvas.height = inCanvas.height;
        }

        // Initialize WebGPU if not already done
        if (!this.webgpuInitialized) {
            if (!this.webgpuInitializing) {
                this.webgpuInitializing = true;
                try {
                    const adapter = await navigator.gpu.requestAdapter();
                    if (adapter) {
                        this.device = await adapter.requestDevice();
                        this.gpuContext = outCanvas.getContext("webgpu");
                        const format = navigator.gpu.getPreferredCanvasFormat();
                        
                        this.gpuContext.configure({
                            device: this.device,
                            format: format,
                            alphaMode: "premultiplied"
                        });

                        const shaderCode = `
                            struct VertexOutput {
                                @builtin(position) position : vec4<f32>,
                                @location(0) texCoord : vec2<f32>,
                            }

                            @vertex
                            fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
                                var pos = array<vec2<f32>, 4>(
                                    vec2<f32>(-1.0,  1.0),
                                    vec2<f32>( 1.0,  1.0),
                                    vec2<f32>(-1.0, -1.0),
                                    vec2<f32>( 1.0, -1.0)
                                );
                                var tex = array<vec2<f32>, 4>(
                                    vec2<f32>(0.0, 0.0),
                                    vec2<f32>(1.0, 0.0),
                                    vec2<f32>(0.0, 1.0),
                                    vec2<f32>(1.0, 1.0)
                                );
                                
                                var output : VertexOutput;
                                output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
                                output.texCoord = tex[VertexIndex];
                                return output;
                            }

                            @group(0) @binding(0) var mySampler: sampler;
                            @group(0) @binding(1) var myTexture: texture_2d<f32>;

                            @fragment
                            fn frag_main(@location(0) texCoord : vec2<f32>) -> @location(0) vec4<f32> {
                                return textureSample(myTexture, mySampler, texCoord);
                            }
                        `;

                        const module = this.device.createShaderModule({ code: shaderCode });

                        this.pipeline = this.device.createRenderPipeline({
                            layout: "auto",
                            vertex: { module, entryPoint: "vert_main" },
                            fragment: { module, entryPoint: "frag_main", targets: [{ format }] },
                            primitive: { topology: "triangle-strip" },
                        });

                        this.sampler = this.device.createSampler({
                            magFilter: "linear",
                            minFilter: "linear",
                        });

                        this.webgpuInitialized = true;
                    }
                } catch (err) {
                    console.error("Failed to initialize WebGPU:", err);
                } finally {
                    this.webgpuInitializing = false;
                }
            }
        }

        if (this.webgpuInitialized) {
            if (this.justUsedEnchanter) {
                this.gpuContext.configure({
                    device: this.device,
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    alphaMode: "premultiplied"
                });
                this.justUsedEnchanter = false;
            }

            let bindGroupNeedsUpdate = false;
            if (!this.frameTexture || 
                this.frameTexture.width !== inCanvas.width || 
                this.frameTexture.height !== inCanvas.height) {
                
                if (this.frameTexture) {
                    this.frameTexture.destroy();
                }

                this.frameTexture = this.device.createTexture({
                    size: [inCanvas.width, inCanvas.height, 1],
                    format: "rgba8unorm",
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
                });
                bindGroupNeedsUpdate = true;
            }

            // Copy the source canvas image data to the GPU Texture (flipY changed to false)
            this.device.queue.copyExternalImageToTexture(
                { source: inCanvas, flipY: false },
                { texture: this.frameTexture },
                [inCanvas.width, inCanvas.height]
            );

            if (!this.bindGroup || bindGroupNeedsUpdate) {
                this.bindGroup = this.device.createBindGroup({
                    layout: this.pipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: this.sampler },
                        { binding: 1, resource: this.frameTexture.createView() }
                    ]
                });
            }

            const commandEncoder = this.device.createCommandEncoder();
            const textureView = this.gpuContext.getCurrentTexture().createView();

            const renderPassDescriptor = {
                colorAttachments: [{
                    view: textureView,
                    clearValue: [0.0, 0.0, 0.0, 1.0],
                    loadOp: "clear",
                    storeOp: "store",
                }],
            };

            const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
            passEncoder.setPipeline(this.pipeline);
            passEncoder.setBindGroup(0, this.bindGroup);
            passEncoder.draw(4);
            passEncoder.end();

            this.device.queue.submit([commandEncoder.finish()]);
        }
    };

    async upscale(inCanvas, outCanvas) {
        this.justUsedEnchanter = true;

        // Yield CPU thread to prevent UI freezing
        await tf.nextFrame();

        const BLOCK_SIZE = 128;
        const FACTOR = 2;
        
        // The inner valid area we keep from the 256x256 prediction
        const VALID_OUT = 240; 
        const PADDING_OUT = (BLOCK_SIZE * FACTOR - VALID_OUT) / 2; // 8px padding on the output

        // What that area translates to on the input
        const VALID_IN = VALID_OUT / FACTOR; // 120px
        const PADDING_IN = PADDING_OUT / FACTOR; // 4px padding on the input

        const outTensor = tf.tidy(() => {
            let tensor = tf.browser.fromPixels(inCanvas).toFloat();

            const originalH = tensor.shape[0];
            const originalW = tensor.shape[1];

            // Calculate grids needed for the valid areas
            const numBlocksY = Math.ceil(originalH / VALID_IN);
            const numBlocksX = Math.ceil(originalW / VALID_IN);

            // Pad the input image so we can extract overlapping 128x128 blocks 
            // starting with a 4px inset to center the valid 120x120 crop
            const paddedH = numBlocksY * VALID_IN + 2 * PADDING_IN; // e.g. grids * 120 + 8
            const paddedW = numBlocksX * VALID_IN + 2 * PADDING_IN;
            
            const padBottom = paddedH - PADDING_IN - originalH;
            const padRight = paddedW - PADDING_IN - originalW;

            tensor = tf.pad(tensor, [
                [PADDING_IN, padBottom], 
                [PADDING_IN, padRight], 
                [0, 0]
            ]);

            // CPU-light extraction (tf.slice + tf.stack) since strides overlap
            let blocksArray = [];
            for (let y = 0; y < numBlocksY; y++) {
                for (let x = 0; x < numBlocksX; x++) {
                    blocksArray.push(tf.slice(
                        tensor, 
                        [y * VALID_IN, x * VALID_IN, 0], 
                        [BLOCK_SIZE, BLOCK_SIZE, 3]
                    ));
                }
            }
            
            let blocks = tf.stack(blocksArray);

            // Batch Predict natively on WebGPU
            let upscaledBlocks = this.upscalerModel.predict(blocks); 

            // Trim the overlapping paddings (8px from all sides) -> leaves 240x240 chunks
            upscaledBlocks = tf.slice(
                upscaledBlocks, 
                [0, PADDING_OUT, PADDING_OUT, 0], 
                [-1, VALID_OUT, VALID_OUT, 3]
            );

            // GPU Accelerated Reconstruction via Matrix Transposing (Zero CPU Loops)
            upscaledBlocks = tf.reshape(upscaledBlocks, [numBlocksY, numBlocksX, VALID_OUT, VALID_OUT, 3]);
            upscaledBlocks = tf.transpose(upscaledBlocks, [0, 2, 1, 3, 4]);
            let finalImage = tf.reshape(upscaledBlocks, [numBlocksY * VALID_OUT, numBlocksX * VALID_OUT, 3]);

            // Slice back exactly to the upscaled original dimensions
            finalImage = tf.slice(finalImage, [0, 0, 0], [originalH * FACTOR, originalW * FACTOR, 3]);
            finalImage = finalImage.clipByValue(0, 255).cast("int32");
            //finalImage.max().print()
            return finalImage;
        });

        // Use the native WebGPU tf.browser.draw function to blast pixels straight to the output
        //await this.drawTensorToCanvas(outTensor, outCanvas);
        await tf.browser.draw(outTensor, outCanvas);
        
        // Manual tensor cleanup
        outTensor.dispose();
    };

    async framegen(frame0, frame1, outCanvas) {
        this.justUsedEnchanter = true;

        // Yield CPU thread to prevent UI freezing
        await tf.nextFrame();

        const BLOCK_SIZE = 128;
        
        const outTensor = tf.tidy(() => {
            // NORMALIZE INPUTS: Scale from [0, 255] down to float [0, 1]
            let t0 = frame0.clone().toFloat().div(255.0);
            let t1 = frame1.clone().toFloat().div(255.0);

            const originalH = t0.shape[0];
            const originalW = t0.shape[1];

            // Pad to multiples of BLOCK_SIZE to allow clean slicing
            const padH = (BLOCK_SIZE - (originalH % BLOCK_SIZE)) % BLOCK_SIZE;
            const padW = (BLOCK_SIZE - (originalW % BLOCK_SIZE)) % BLOCK_SIZE;
            
            if (padH > 0 || padW > 0) {
                t0 = tf.pad(t0, [[0, padH], [0, padW], [0, 0]]);
                t1 = tf.pad(t1, [[0, padH], [0, padW], [0, 0]]);
            }

            const ph = t0.shape[0];
            const pw = t0.shape[1];
            const numBlocksY = ph / BLOCK_SIZE;
            const numBlocksX = pw / BLOCK_SIZE;

            // GPU Accelerated Slicing via Matrix Transposing
            let blocks0 = tf.reshape(t0, [numBlocksY, BLOCK_SIZE, numBlocksX, BLOCK_SIZE, 3]);
            blocks0 = tf.transpose(blocks0, [0, 2, 1, 3, 4]); 
            blocks0 = tf.reshape(blocks0, [numBlocksY * numBlocksX, BLOCK_SIZE, BLOCK_SIZE, 3]);

            let blocks1 = tf.reshape(t1, [numBlocksY, BLOCK_SIZE, numBlocksX, BLOCK_SIZE, 3]);
            blocks1 = tf.transpose(blocks1, [0, 2, 1, 3, 4]); 
            blocks1 = tf.reshape(blocks1, [numBlocksY * numBlocksX, BLOCK_SIZE, BLOCK_SIZE, 3]);

            // Predict the generated frame
            let generatedBlocks = this.framegenModel.predict([blocks0, blocks1]);

            
            if (!generatedBlocks.shape) {
                generatedBlocks = Object.values(generatedBlocks)[0];
            }

            // GPU Accelerated Reconstruction via Matrix Transposing
            generatedBlocks = tf.reshape(generatedBlocks, [numBlocksY, numBlocksX, BLOCK_SIZE, BLOCK_SIZE, 3]);
            generatedBlocks = tf.transpose(generatedBlocks, [0, 2, 1, 3, 4]);
            let finalImage = tf.reshape(generatedBlocks, [numBlocksY * BLOCK_SIZE, numBlocksX * BLOCK_SIZE, 3]);

            // Trim off the padding to restore original dimensions
            if (padH > 0 || padW > 0) {
                finalImage = tf.slice(finalImage, [0, 0, 0], [originalH, originalW, 3]);
            }
            
            // DENORMALIZE OUTPUT: Scale from [0, 1] back up to [0, 255] and cast to integers
            return finalImage.mul(255.0).clipByValue(0, 255).cast("int32");
        });

        // Render the newly generated frame
        outTensor.max().print();
        this.frameCounter = true;
        this.frameCounter3++;
        return outTensor;
    };

    async framegen2(frame0, frame1, outCanvas) {
        this.justUsedEnchanter = true;

        // Yield CPU thread to prevent UI freezing
        await tf.nextFrame();

        const BLOCK_SIZE = 128;
        
        const outTensor = tf.tidy(() => {
            // NORMALIZE INPUTS: Scale from [0, 255] down to float [0, 1]
            let t0 = frame0.clone().toFloat().div(255.0);
            let t1 = frame1.clone().toFloat().div(255.0);

            const originalH = t0.shape[0];
            const originalW = t0.shape[1];

            // Pad to multiples of BLOCK_SIZE to allow clean slicing
            const padH = (BLOCK_SIZE - (originalH % BLOCK_SIZE)) % BLOCK_SIZE;
            const padW = (BLOCK_SIZE - (originalW % BLOCK_SIZE)) % BLOCK_SIZE;
            
            if (padH > 0 || padW > 0) {
                t0 = tf.pad(t0, [[0, padH], [0, padW], [0, 0]]);
                t1 = tf.pad(t1, [[0, padH], [0, padW], [0, 0]]);
            }

            const ph = t0.shape[0];
            const pw = t0.shape[1];
            const numBlocksY = ph / BLOCK_SIZE;
            const numBlocksX = pw / BLOCK_SIZE;

            // GPU Accelerated Slicing via Matrix Transposing
            let blocks0 = tf.reshape(t0, [numBlocksY, BLOCK_SIZE, numBlocksX, BLOCK_SIZE, 3]);
            blocks0 = tf.transpose(blocks0, [0, 2, 1, 3, 4]); 
            blocks0 = tf.reshape(blocks0, [numBlocksY * numBlocksX, BLOCK_SIZE, BLOCK_SIZE, 3]);

            let blocks1 = tf.reshape(t1, [numBlocksY, BLOCK_SIZE, numBlocksX, BLOCK_SIZE, 3]);
            blocks1 = tf.transpose(blocks1, [0, 2, 1, 3, 4]); 
            blocks1 = tf.reshape(blocks1, [numBlocksY * numBlocksX, BLOCK_SIZE, BLOCK_SIZE, 3]);

            // Predict the generated frame
            let generatedBlocks = this.framegenModel2.predict([blocks0, blocks1]);

            
            if (!generatedBlocks.shape) {
                generatedBlocks = Object.values(generatedBlocks)[0];
            }

            // GPU Accelerated Reconstruction via Matrix Transposing
            generatedBlocks = tf.reshape(generatedBlocks, [numBlocksY, numBlocksX, BLOCK_SIZE, BLOCK_SIZE, 3]);
            generatedBlocks = tf.transpose(generatedBlocks, [0, 2, 1, 3, 4]);
            let finalImage = tf.reshape(generatedBlocks, [numBlocksY * BLOCK_SIZE, numBlocksX * BLOCK_SIZE, 3]);

            // Trim off the padding to restore original dimensions
            if (padH > 0 || padW > 0) {
                finalImage = tf.slice(finalImage, [0, 0, 0], [originalH, originalW, 3]);
            }
            
            // DENORMALIZE OUTPUT: Scale from [0, 1] back up to [0, 255] and cast to integers
            return finalImage.mul(255.0).clipByValue(0, 255).cast("int32");
        });

        // Render the newly generated frame
        outTensor.max().print();
        this.frameCounter = true;
        this.frameCounter3++;
        return outTensor;
    };
};
const enchanter = new Enchanter();
globalThis.enchanter = enchanter;

// UI classes
// Display screen behaviour
const LoadingDialog = class {
    constructor() {
        this.overlay = document.getElementById("dialog-overlay");
        this.loading = document.getElementById("dialog-loading");
    };
    open = () => {
        this.loading.classList.add("active");
        this.overlay.classList.add("blur");
        this.overlay.classList.add("active");
    };
    close = () => {
        // close dialog
        this.loading.classList.remove("active");
        this.overlay.classList.remove("blur");
        this.overlay.classList.remove("active");
        
    };
};

const MenuComponent = class extends EventTarget {
    constructor() {
        super();
        // events: dialog, btn-new, btn-downloads, btn-settings
        const MenuDialog = class extends EventTarget {
            constructor() {
                super();
                // events: close, btn-new, btn-downloads
                // get important elements
                this.overlay = document.getElementById("dialog-overlay");
                this.dialog = document.getElementById("dialog-menu");
                this.closeBtn = document.getElementById("btn-menu-close");
                this.newBtn = document.getElementById("btn-new-2");
                this.downloadsBtn = document.getElementById("btn-downloads-2");

                // hide if no clients available or desktop
                if (environment.desktop.isAvailable || environment.server["clients"].length === 0) {
                    this.downloadsBtn.classList.add("hide");
                }
            };
            open = () => {
                this.overlay.classList.add("active");
                this.dialog.classList.add("active");
                window.addEventListener("resize", this.resize);
                this.closeBtn.addEventListener("click", this.triggerClose);
                this.overlay.addEventListener("click", this.triggerClose);
                this.newBtn.addEventListener("click", this.onNew);
                this.downloadsBtn.addEventListener("click", this.onDownloads);
            };
            close = () => {
                this.overlay.classList.remove("active");
                this.dialog.classList.remove("active");
                window.removeEventListener("resize", this.resize);
                this.overlay.removeEventListener("click", this.triggerClose);
                
            };
            resize = () => {
                const sizeS = 600;
                const width = window.innerWidth;
                if (sizeS < width) {
                    this.triggerClose();
                };
            };
            triggerClose = () => {
                this.dispatchEvent(new CustomEvent("close"));
            };
            onNew = () => {
                this.triggerClose();
                this.dispatchEvent(new CustomEvent("btn-new"));
            };
            onDownloads = () => {
                this.triggerClose();
                this.dispatchEvent(new CustomEvent("btn-downloads"));
            };
        };
        this.menuDialog = new MenuDialog();

        this.menuBtn = document.getElementById("btn-menu-left");
        this.menuBtn2 = document.getElementById("btn-menu-top");
        this.newBtn = document.getElementById("btn-new");
        this.downloadsBtn = document.getElementById("btn-downloads");
        this.settingsBtn = document.getElementById("btn-settings");

        this.menuBtn.addEventListener("click", () => {
            this.isMenuMax = !this.isMenuMax;
            this.switchMenu();
        });
        this.menuBtn2.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("dialog", {
                "detail": {
                    "dialog": this.menuDialog
                }
            }));
        });

        const width = window.innerWidth;
        const sizeS = 600;
        const sizeM = 993;
        this.isMenuMax = false;
        if (sizeS < width) {
            if (width < sizeM) {
                this.isMenuMax = false;
                this.switchMenu();
            } else {
                this.isMenuMax = true;
                this.switchMenu();
            }
        }

        // hide if no clients available or desktop
        if (environment.desktop.isAvailable || environment.server["clients"].length === 0) {
            this.downloadsBtn.classList.add("hide");
        }
    };
    switchMenu(isMax=this.isMenuMax) {
        if (isMax) {
            this.menuBtn.parentElement.parentElement.classList.add("max");
            this.downloadsBtn.classList.add("primary");
            this.downloadsBtn.children[0].classList.remove("primary");
        } else {
            this.menuBtn.parentElement.parentElement.classList.remove("max");
            this.downloadsBtn.classList.remove("primary");
            this.downloadsBtn.children[0].classList.add("primary");
        }
    };
    open = () => {
        this.menuDialog.addEventListener("close", this.onDialog);
        this.menuDialog.addEventListener("btn-new", this.onNew);
        this.menuDialog.addEventListener("btn-downloads", this.onDownloads);
        this.newBtn.addEventListener("click", this.onNew);
        this.downloadsBtn.addEventListener("click", this.onDownloads);
        this.settingsBtn.addEventListener("click", this.onSettings);

    };
    close = () => {
        this.menuDialog.removeEventListener("close", this.onDialog);
        this.menuDialog.removeEventListener("btn-new", this.onNew);
        this.menuDialog.removeEventListener("btn-downloads", this.onDownloads);
        this.newBtn.removeEventListener("click", this.onNew);
        this.downloadsBtn.removeEventListener("click", this.onDownloads);
        this.settingsBtn.removeEventListener("click", this.onSettings);
    };
    onDialog = (dialog) => {
        this.dispatchEvent(new CustomEvent("dialog", {
            "detail": {
                "dialog": undefined
            }
        }));
    };
    onNew = () => {
        this.dispatchEvent(new CustomEvent("btn-new"));
    };
    onDownloads = () => {
        this.dispatchEvent(new CustomEvent("btn-downloads"));
    };
    onSettings = () => {
        this.dispatchEvent(new CustomEvent("btn-settings"));
    };
};

const SettingsDialog = class extends EventTarget {
    constructor() {
        super();

        const listDevicesHelper = async function (type) {
            const selectedDevices = [];
            let devices = await navigator.mediaDevices.enumerateDevices();
            for (let device of devices) {
                if (device.kind === type && (device.deviceId !== "default" || device.deviceId !== "communications")) {
                    selectedDevices.push(device);
                }
            }
            const startLenght = selectedDevices.length;
            for (let i = startLenght - 1; i > -1; i--) {
                if (selectedDevices[i].deviceId === "" ) {
                    selectedDevices.splice(i, 1);
                }
            }

            if (selectedDevices.length === 0 && startLenght !== 0) {
                return undefined;
            }
            return selectedDevices;
        };
        const listDevices = async function(type="audioinput") {
            // try to list device
            let selectedDevices = await listDevicesHelper(type);

            // try to get permission by accessing microphone
            if (selectedDevices === undefined) {
                try {
                    const accessMediaStream = await navigator.mediaDevices.getUserMedia({"audio": true, "video": true});
                    const accessTracks = accessMediaStream.getTracks();
                    for (let track of accessTracks) {
                        track.stop();
                    }
                } catch(err) {
                    console.log(err);
                }

                // try to list device again
                selectedDevices = await listDevicesHelper(type);
                if (selectedDevices === undefined) {
                    return [];
                }
            }
                        
            return selectedDevices;
        };

        const AppearanceTab = class {
            constructor() {
                this.win = document.getElementById("settings-appearance");
                this.btn = document.getElementById("btn-settings-appearance");

                // language settings
                this.langSelect = document.getElementById("select-appearance-lang");
                this.langSelect.addEventListener("change", async (event) => {
                    let lang = event.target.value;
                    await environment.setDatabaseValue("lang", lang);
                    localization.setLang(lang);
                    localization.translate();
                    if (environment.desktop.isAvailable) {
                        environment.desktop.ipcRenderer.send("api", "set-lang", lang);
                    }
                });

                // theme settings
                this.themeBtn = document.getElementById("btn-appearance-theme");
                this.themeBtn.addEventListener("click", async () => {
                    if (environment.configuration["mode"] === "auto") {
                        environment.configuration["mode"] = "light";
                    } else if (environment.configuration["mode"] === "light") {
                        environment.configuration["mode"] = "dark";
                    } else {
                        environment.configuration["mode"] = "auto";
                    }
                    let mode = environment.configuration["mode"];
                    if (mode === "auto") {
                        mode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                    }
                    globalThis.ui("mode", mode);
                    this.setThemeIcon();
                    await environment.setDatabaseValue("mode", environment.configuration["mode"]);
                });
                document.getElementById("btn-appearance-theme-color").addEventListener("change", (event) => {
                    const color = event.target.value;
                    this.setColor(color);
                });
                document.getElementById("btn-appearance-theme-green").addEventListener("click", (event) => {
                    this.setColor("#006e1c");
                });
                document.getElementById("btn-appearance-theme-red").addEventListener("click", (event) => {
                    this.setColor("#f44336");
                });
                document.getElementById("btn-appearance-theme-pink").addEventListener("click", (event) => {
                    this.setColor("#e91e63");
                });
                document.getElementById("btn-appearance-theme-purple").addEventListener("click", (event) => {
                    this.setColor("#9c27b0");
                });
                document.getElementById("btn-appearance-theme-indigo").addEventListener("click", (event) => {
                    this.setColor("#3f51b5");
                });
                document.getElementById("btn-appearance-theme-blue").addEventListener("click", (event) => {
                    this.setColor("#2196f3");
                });
                document.getElementById("btn-appearance-theme-yellow").addEventListener("click", (event) => {
                    this.setColor("#ffeb3b");
                });
                document.getElementById("btn-appearance-theme-orange").addEventListener("click", (event) => {
                    this.setColor("#ff9800");
                });

                // tray setting
                this.trayCheckbox = document.getElementById("checkbox-tray");
                this.trayLabel = document.getElementById("label-tray");
                this.trayError = document.getElementById("error-tray");
                if (environment.desktop.isAvailable) {
                    this.trayLabel.classList.remove("hide");
                    this.trayCheckbox.checked = environment.configuration["minimizing"];
                    this.trayCheckbox.addEventListener("change", async (event) => {
                        const isChecked = event.target.checked;
                        environment.configuration["minimizing"] = isChecked;
                        environment.desktop.ipcRenderer.send("api", "set-tray", isChecked);
                        await environment.setDatabaseValue("minimizing", isChecked);
                    });
                } else {
                    this.trayError.classList.remove("hide");
                }

                // auto lanunch
                this.autoLaunchLabel = document.getElementById("label-auto-launch");
                this.autoLaunchCheckbox = document.getElementById("checkbox-auto-launch");
                this.autoLaunchError = document.getElementById("error-auto-launch");
                if (environment.desktop.isAvailable) {
                    this.autoLaunchLabel.classList.remove("hide");
                    console.log(environment.desktop.autoLaunch);
                    environment.desktop.autoLaunch.isEnabled().then((isEnabled) => {
                        this.autoLaunchCheckbox.checked = isEnabled;
                    });
                    this.autoLaunchCheckbox.addEventListener("change", async (event) => {
                        const isChecked = event.target.checked;
                        if (isChecked) {
                            await environment.desktop.autoLaunch.enable();
                        } else {
                            await environment.desktop.autoLaunch.disable();
                        }
                        const isEnabled = await environment.desktop.autoLaunch.isEnabled();
                        event.target.checked = isEnabled;
                        environment.configuration["autoLaunch"] = isEnabled;
                        await environment.setDatabaseValue("autoLaunch", isEnabled);
                    });

                } else {
                    this.autoLaunchError.classList.remove("hide");
                }
            };
            open = () => {
                this.langSelect.value = environment.configuration["lang"];
                this.setThemeIcon();

                this.win.classList.remove("hide");
                this.btn.classList.add("primary");
                this.btn.classList.remove("fill");
            };
            close = () => {
                this.win.classList.add("hide");
                this.btn.classList.remove("primary");
                this.btn.classList.add("fill");
            };
            setThemeIcon() {
                if (environment.configuration["mode"] === "auto") {
                    this.themeBtn.children[0].innerText = "hdr_auto";
                } else if (environment.configuration["mode"] === "light") {
                    this.themeBtn.children[0].innerText = "light_mode";
                } else {
                    this.themeBtn.children[0].innerText = "dark_mode";
                }
            };
            async setColor(color) {
                globalThis.ui("theme", color);
                await environment.setDatabaseValue("color", color);
            };
        };

        const AudioTab = class {
            constructor() {
                this.win = document.getElementById("settings-audio");
                this.btn = document.getElementById("btn-settings-audio");
                const browser = environment.checkBrowser();

                this.audioSpeakerContext = null;
                this.audioMicContext = null;

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
                if (environment.desktop.isAvailable) {
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
                this.speakerSelect.addEventListener("change", (event) => {
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
                        url = "/media/sound-test-1.mp3";
                    } else if (value === "1") {
                        url = "/media/sound-test-2.mp3";
                    } else {
                        url = "/media/sound-test-3.mp3";
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
                    source.onended = (event) => {
                        this.speakerStop();
                    };
                });

                // mic test
                this.micSelect = document.getElementById("select-audio-input");
                this.micRefresh = document.getElementById("btn-refresh-audio-input");
                this.micTest = document.getElementById("btn-test-audio-input");
                this.listMic = async () => {
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
                        const option = new Option(localization.get("settings.audio.mic.notfound"), "");
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
                navigator.mediaDevices.addEventListener("devicechange", () => {
                    this.listMic();
                });
                this.micRefresh.addEventListener("click", () => {
                    this.listMic();
                });
                this.micSelect.addEventListener("change", (event) => {
                    const deviceId = event.target.value;
                    if (deviceId === "") {
                        this.micTest.disabled = true;
                    } else {
                        this.micTest.disabled = false;
                    }
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
            open = () => {
                this.win.classList.remove("hide");
                this.btn.classList.add("primary");
                this.btn.classList.remove("fill");
                this.listMic();
            };
            close = () => {
                this.win.classList.add("hide");
                this.btn.classList.remove("primary");
                this.btn.classList.add("fill");
                this.speakerStop();
                this.micStop();
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
        };

        const VideoTab = class {
            constructor() {
                this.win = document.getElementById("settings-video");
                this.btn = document.getElementById("btn-settings-video");

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
                this.listCam = async () => {
                    // list audio input devices
                    const selectedDevices = await listDevices("videoinput");

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
                navigator.mediaDevices.addEventListener("devicechange", () => {
                    this.listCam();
                });
                this.cameraRefresh.addEventListener("click", () => {
                    this.listCam();
                });
                this.cameraSelect.addEventListener("change", (event) => {
                    const deviceId = event.target.value;
                    if (deviceId === "") {
                        this.cameraTest.disabled = true;
                    } else {
                        this.cameraTest.disabled = false;
                    }
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
                if (environment.desktop.isAvailable) {
                    this.listDisplay = async () => {
                        const screens = environment.desktop.Control.Screen.list();
                        if (screens.length === 0) {
                            // remove all old options
                            const select = this.displaySelect;
                            for (let i = select.options.length-1; i > -1; i--) {
                                select.remove(i);
                            }
                            this.displaySelect.disabled = true;
                            this.displayTest.disabled = true;
                            const option = new Option(localization.get("settings.video.display.notfound"), "");
                            select.add(option);
                            select.dispatchEvent(new Event("change"));
                        } else {
                            // remove all old options
                            const select = this.displaySelect;
                            for (let i = select.options.length-1; i > -1; i--) {
                                select.remove(i);
                            }
                            this.displaySelect.disabled = false;
                            for (let i = 0; i < screens.length; i++) {
                                const option = new Option(localization.get("settings.video.display.name") + " " +  (i+1), i);
                                this.displaySelect.add(option);
                            }
                            this.displaySelect.dispatchEvent(new Event("change"));
                        }
                    };
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
                        console.log(trackGenerator)
                        const writer = trackGenerator.writable.getWriter();
                        const stream = new MediaStream([trackGenerator]);

                        this.decoder = new Decoder();
                        this.decoder.onVideoFrame = async (frame) => {
                            //console.log("Decoded video frame:", frame);
                            try {
                                await writer.write(frame);
                            } catch (e) {
                                console.error("Failed to write frame:", e);
                            } finally {
                                frame.close();
                            }
                        };
                        this.videoEncoderFFmpeg = new environment.desktop.FFmpegVideoEncoder();
                        this.videoEncoderFFmpeg.onConfiguration = (config) => {
                            //console.log("Video configuration:", config);
                            this.decoder.appendVideoConfiguration(config);
                        };
                        this.videoEncoderFFmpeg.onChunk = (chunk) => {
                            //console.log("Video chunk:", chunk);
                            this.decoder.appendVideoChunk(chunk);
                        };
                        this.videoEncoderFFmpeg.onEnd = (error) => {
                            //console.log("Video encoding ended with error code:", error);
                        };

                        const ffpmegParams = [];
                        ffpmegParams.push(
                            "-fflags", "+nobuffer+flush_packets",
                            "-flags", "+low_delay",
                            "-analyzeduration", "0",         // Don't analyze input
                            "-probesize", "32",              // Minimum probe size
                            "-thread_queue_size", "8"       // Small queue");
                        );
                        if (environment.desktop.os.platform() === "win32") {
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
                            environment.desktop.ffmpegPath,
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
            open = () => {
                this.win.classList.remove("hide");
                this.btn.classList.add("primary");
                this.btn.classList.remove("fill");
                this.listCam();
            };
            close = () => {
                this.win.classList.add("hide");
                this.btn.classList.remove("primary");
                this.btn.classList.add("fill");
                this.stopCam();
                this.stopDisplay();
            };
        };

        const ControlTab = class {
            constructor() {
                this.win = document.getElementById("settings-control");
                this.btn = document.getElementById("btn-settings-control");

                // check mouse share support
                this.mouseShareSupport = document.getElementById("mouse-share-support");
                this.mouseShareUnsupport = document.getElementById("mouse-share-unsupport");
                if (environment.desktop.isAvailable) {
                    this.mouseShareSupport.classList.remove("hide");
                } else {
                    this.mouseShareUnsupport.classList.remove("hide");
                }

                // exit shortcuts
                this.Shortcut = class extends EventTarget {
                    constructor(delay, keys, editable) {
                        super();
                        this.delay = delay;
                        this.keys = keys;
                        this.editable = editable;
                        
                        const div = document.createElement("div");
                        const html = `
                            <div class="shortcut-box">
                                <div class="field label suffix border round shortcut-delay">
                                    <select ${editable ? "" : "disabled"}>
                                        <option value="1" data-i18n="settings.control.exit-shortcut.delay-unit1">${localization.get("settings.control.exit-shortcut.delay-unit1")}</option>
                                        <option value="2" data-i18n="settings.control.exit-shortcut.delay-unit2">${localization.get("settings.control.exit-shortcut.delay-unit2")}</option>
                                        <option value="3" data-i18n="settings.control.exit-shortcut.delay-unit3">${localization.get("settings.control.exit-shortcut.delay-unit3")}</option>
                                        <option value="4" data-i18n="settings.control.exit-shortcut.delay-unit4">${localization.get("settings.control.exit-shortcut.delay-unit4")}</option>
                                        <option value="5" data-i18n="settings.control.exit-shortcut.delay-unit5">${localization.get("settings.control.exit-shortcut.delay-unit5")}</option>
                                        <option value="6" data-i18n="settings.control.exit-shortcut.delay-unit6">${localization.get("settings.control.exit-shortcut.delay-unit6")}</option>
                                        <option value="7" data-i18n="settings.control.exit-shortcut.delay-unit7">${localization.get("settings.control.exit-shortcut.delay-unit7")}</option>
                                    </select>
                                    <label>${localization.get("settings.control.exit-shortcut.delay")}</label>
                                    <i class="material-icons">arrow_drop_down</i>
                                </div>
                                <div class="shortcut-box-sub">
                                    <div class="field label border round shortcut-key">
                                        <input type="text" ${editable ? "" : "disabled"} value="${this.keys.length === 0 ? localization.get("settings.control.exit-shortcut.none") : this.keys.join(" + ")}" />
                                        <label>${localization.get("settings.control.exit-shortcut.key")}</label>
                                    </div>
                                    <div class="shortcut-delete" style="${editable ? "" : "visibility: hidden"}">
                                        <button class="circle large">
                                            <i class="material-icons">delete</i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `.trim();
                        div.innerHTML = html;
                        this.el = div.firstChild;

                        this.delaySelect = this.el.querySelector("select");
                        this.delaySelect.value = this.delay;
                        this.keyInput = this.el.querySelector("input");
                        this.deleteBtn = this.el.querySelector(".shortcut-delete button");

                        if (editable) {
                            this.delaySelect.addEventListener("change", async (event) => {
                                this.delay = event.target.value;
                                this.dispatchEvent(new CustomEvent("change", {"detail": {"delay": this.delay, "keys": this.keys}}));
                            });
                            let firstKey = "";
                            const allkeys = new Set();
                            this.keyInput.addEventListener("keydown", (event) => {
                                event.preventDefault();
                                const key = event.key;
                                if (firstKey === "") {
                                    allkeys.clear();
                                    firstKey = key;
                                }
                                allkeys.add(key);
                                event.target.value = Array.from(allkeys).join(" + ");
                            });
                            this.keyInput.addEventListener("keyup", async (event) => {
                                event.preventDefault();
                                const key = event.key;
                                if (key === firstKey) {
                                    event.preventDefault();
                                    const key = event.key;
                                    if (key === firstKey) {
                                        firstKey = "";
                                        this.keys = Array.from(allkeys);
                                        this.dispatchEvent(new CustomEvent("change", {"detail": {"delay": this.delay, "keys": this.keys}}));
                                    }
                                }
                            });
                            this.deleteBtn.addEventListener("click", () => {
                                this.dispatchEvent(new CustomEvent("delete"));
                            });
                        }
                    };
                };
                this.shortcuts = [];
                this.shortcutList = document.getElementById("shortcut-list");
                this.shortcutAdd = document.getElementById("btn-shortcut-add");
                this.shortcutAdd.addEventListener("click", async () => {
                    this.addShortcut("1", [], true);
                });
            };
            addShortcut(delay, keys, editable) {
                const shortcut = new this.Shortcut(delay, keys, editable);
                shortcut.addEventListener("change", this.saveShortcuts.bind(this));
                shortcut.addEventListener("delete", () => {
                    shortcut.el.remove();
                    this.shortcuts.splice(this.shortcuts.indexOf(shortcut), 1);
                    this.saveShortcuts();
                });
                this.shortcutList.appendChild(shortcut.el);
                this.shortcuts.push(shortcut);
            };
            async saveShortcuts() {
                const shortcutObj = [];
                const shortcuts = this.shortcuts;
                for (const shortcut of shortcuts) {
                    if (shortcut.editable === false) {
                        continue;
                    }
                    if (shortcut.keys.length === 0) {
                        continue;
                    }
                    shortcutObj.push({
                        "delay": shortcut.delay,
                        "keys": shortcut.keys
                    });
                }
                await environment.setDatabaseValue("exitShortcuts", JSON.stringify(shortcutObj));
            };
            open = () => {
                // add browser specific shortcuts
                if (environment.desktop.isAvailable === true) {
                    this.addShortcut("5", ["ESC"], false);
                } else {
                    this.addShortcut("1", ["ESC"], false);
                    this.addShortcut("1", ["F11"], false);
                }

                // add user defined shortcut
                this.shortcuts = [];
                const loadedShortcuts = JSON.parse(environment.configuration["exitShortcuts"]);
                for (const shortcut of loadedShortcuts) {
                    this.addShortcut(shortcut.delay, shortcut.keys, true);
                }

                this.win.classList.remove("hide");
                this.btn.classList.add("primary");
                this.btn.classList.remove("fill");
            };
            close = () => {
                this.shortcuts = [];
                this.shortcutList.innerHTML = "";

                this.win.classList.add("hide");
                this.btn.classList.remove("primary");
                this.btn.classList.add("fill");
            };
        };

        const AboutTab = class {
            constructor() {
                this.win = document.getElementById("settings-about");
                this.btn = document.getElementById("btn-settings-about");

                const browser = environment.checkBrowser();

                this.version = document.getElementById("about-version");
                this.version.innerText = "0.1.0";

                this.supported = document.getElementById("about-supported");
                let isMissing = false;

                // check autolaunch support
                this.autoLanuch = document.getElementById("about-auto-launch");
                if (environment.desktop.isAvailable === false) {
                    isMissing = true;
                    this.autoLanuch.classList.remove("hide");
                }

                // check tray support
                this.tray = document.getElementById("about-tray");
                if (environment.desktop.isAvailable === false) {
                    isMissing = true;
                    this.tray.classList.remove("hide");
                }

                // check system audio share support
                this.systemAudio = document.getElementById("about-audio");
                this.systemAudio2 = document.getElementById("about-audio-unsupported");
                if (environment.desktop.isAvailable === false) {
                    isMissing = true;
                    if (browser["isChrome"] || browser["isOpera"] || browser["isEdgeChromium"]) {
                        this.systemAudio.classList.remove("hide");
                    } else {
                        this.systemAudio2.classList.remove("hide");
                    }
                }

                // check screen share support
                this.screenShare = document.getElementById("about-screen");
                if (environment.desktop.isAvailable === false) {
                    isMissing = true;
                    this.screenShare.classList.remove("hide");
                }

                // check play support
                this.playback = document.getElementById("about-play");
                if (environment.desktop.isAvailable === false && (typeof VideoDecoder === "undefined" || typeof AudioDecoder === "undefined")) {
                    isMissing = true;
                    this.playback.classList.remove("hide");
                }

                // check control share support
                this.controlShare = document.getElementById("about-control");
                if (environment.desktop.isAvailable === false) {
                    isMissing = true;
                    this.controlShare.classList.remove("hide");
                }

                if (isMissing === false) {
                    this.supported.classList.remove("hide");
                }
            };
            open = () => {
                this.win.classList.remove("hide");
                this.btn.classList.add("primary");
                this.btn.classList.remove("fill");
            };
            close = () => {
                this.win.classList.add("hide");
                this.btn.classList.remove("primary");
                this.btn.classList.add("fill");
            };
        };

        this.overlay = document.getElementById("dialog-overlay");
        this.dialog = document.getElementById("dialog-settings");
        this.closeBtn = document.getElementById("btn-settings-close");

        this.appearanceTab = new AppearanceTab();
        this.audioTab = new AudioTab();
        this.videoTab = new VideoTab();
        this.controlTab = new ControlTab();
        this.aboutTab = new AboutTab();

        // category change
        this.currentTab = this.appearanceTab;
        document.getElementById("btn-settings-appearance").addEventListener("click", () => {
            this.changeTab(this.appearanceTab);
        });
        document.getElementById("btn-settings-audio").addEventListener("click", () => {
            this.changeTab(this.audioTab);
        });
        document.getElementById("btn-settings-video").addEventListener("click", () => {
            this.changeTab(this.videoTab);
        });
        document.getElementById("btn-settings-control").addEventListener("click", () => {
            this.changeTab(this.controlTab);
        });
        document.getElementById("btn-settings-about").addEventListener("click", () => {
            this.changeTab(this.aboutTab);
        });
    };
    open = () => {
        this.overlay.classList.add("active");
        this.dialog.classList.add("active");
        this.closeBtn.addEventListener("click", this.triggerClose);
        this.overlay.addEventListener("click", this.triggerClose);
        this.currentTab.open();
    };
    close = () => {
        this.overlay.classList.remove("active");
        this.dialog.classList.remove("active");
        this.closeBtn.removeEventListener("click", this.triggerClose);
        this.overlay.removeEventListener("click", this.triggerClose);
        this.currentTab.close();
    };
    triggerClose = () => {
        this.dispatchEvent(new CustomEvent("close"));
    };
    changeTab(tab) {
        this.currentTab.close();
        tab.open();
        this.currentTab = tab;
    };
};

const NewScreen = class extends EventTarget {
    constructor() {
        super();

        const CreateDialog = class extends EventTarget {
            constructor() {
                super();

                this.overlay = document.getElementById("dialog-overlay");
                this.dialog = document.getElementById("dialog-room-create");
                this.closeBtn = document.getElementById("btn-room-create-close");
                this.copyBtn = document.getElementById("btn-room-create-copy");

                this.dialogRequest = document.getElementById("dialog-room-request");
                this.dialogRequestBar = document.getElementById("room-request-reject-bar");
                this.dialogRequestInfo = document.getElementById("dialog-room-request-info");
                this.dialogRequestReject = document.getElementById("btn-request-reject");
                this.dialogRequestAccept = document.getElementById("btn-request-accept");
                this.dialogRequestUpdateInterval = -1;
                this.dialogRequestStartTime = 0;

                this.loading = document.getElementById("input-room-create-loading");
                this.inputField = document.getElementById("input-room-create-code");
                
                this.currentState = "closed"; // tracks if async data is actually loaded/cleaned up
                this.targetState = "closed";  // tracks the user's latest request
                this.taskQueue = Promise.resolve();

                this.copyBtn.addEventListener("click", () => {
                    if (!navigator.clipboard) {
                        this.inputField.select();
                        document.execCommand("copy");
                        return;
                    }
                    this.inputField.select();
                    this.inputField.setSelectionRange(0, 99999);
                    navigator.clipboard.writeText(this.inputField.value);
                });
                this.dialogRequestReject.addEventListener("click", () => {
                    this.rejectRequest();
                });
                this.dialogRequestAccept.addEventListener("click", () => {
                    this.acceptRequest();
                });
            };

            open = () => {
                this.targetState = "open";

                // 1. Execute visual changes synchronously and immediately
                this.overlay.classList.add("active");
                this.dialog.classList.add("active");
                this.closeBtn.addEventListener("click", this.triggerClose);
                //this.overlay.addEventListener("click", this.triggerClose);

                // 2. Queue the async work
                this.taskQueue = this.taskQueue.then(async () => {
                    // Ignore this task if the user changed their mind before it started
                    if (this.targetState !== "open") return;
                    
                    // Don't fetch again if we are already opened
                    if (this.currentState === "open") return;

                    await this.openAsync();
                    
                    this.currentState = "open";
                    console.log("Data opened");
                }).catch(console.error);
            };
            close = () => {
                this.targetState = "closed";

                // 1. Execute visual changes synchronously and immediately
                this.closeRequest();
                this.overlay.classList.remove("active");
                this.dialog.classList.remove("active");
                this.closeBtn.removeEventListener("click", this.triggerClose);
                this.overlay.removeEventListener("click", this.triggerClose);

                // 2. Queue the async work
                this.taskQueue = this.taskQueue.then(async () => {
                    // Ignore this task if the user changed their mind before it started
                    if (this.targetState !== "closed") return;
                    
                    // Don't teardown again if we are already closed
                    if (this.currentState === "closed") return;

                    await this.closeAsync();

                    this.currentState = "closed";
                    console.log("Data closed");
                }).catch(console.error);
            };

            openAsync = async () => {
                this.loading.classList.remove("hide");
                this.inputField.parentElement.classList.add("prefix");
                this.inputField.disabled = true;

                const pairCode = await server.pairCreate();
                server.addEventListener("pair-request", this.openRequest);

                this.inputField.value = pairCode;
                this.loading.classList.add("hide");
                this.inputField.parentElement.classList.remove("prefix");
                this.inputField.disabled = false;
            };
            closeAsync = async () => {
                this.loading.classList.remove("hide");
                this.inputField.parentElement.classList.add("prefix");
                this.inputField.disabled = true;
                this.inputField.value = "";

                await server.pairDelete();
                server.removeEventListener("pair-request", this.openRequest);
            };
                
            triggerClose = () => {
                this.dispatchEvent(new CustomEvent("close"));
            };
            openRequest = (event) => {
                this.closeBtn.removeEventListener("click", this.triggerClose);
                this.overlay.removeEventListener("click", this.triggerClose);
                this.dialog.classList.remove("active");

                const detail = event.detail;
                const timeout = detail["timeout"];
                const ip = detail["ip"];

                this.dialogRequest.classList.add("active");
                let infoText = localization.get("new.share.request-info");
                infoText = localization.putParameters(infoText, new Map([
                    ["ipAddress", ip],
                ]));
                this.dialogRequestInfo.innerHTML = infoText;

                this.dialogRequestStartTime = Date.now();
                this.dialogRequestUpdateInterval = setInterval(() => {
                    const progress = (Date.now() - this.dialogRequestStartTime) / timeout * 10000;
                    this.dialogRequestBar.value = progress;
                    if (progress >= 10000) {
                        this.rejectRequest();
                    }
                }, 16);

                server.addEventListener("pair-reject", this.closeRequest);

            };
            closeRequest = () => {
                server.removeEventListener("pair-reject", this.closeRequest);
                this.closeBtn.addEventListener("click", this.triggerClose);
                this.overlay.addEventListener("click", this.triggerClose);
                this.dialogRequest.classList.remove("active");
                this.dialog.classList.add("active");
                clearInterval(this.dialogRequestUpdateInterval);
            };
            rejectRequest = async () => {
                try {
                    await server.pairReject();
                } catch (e) {
                    
                }
                this.closeRequest();
            };
            acceptRequest = async () => {
                let isError = false;
                try {
                    await server.pairAccept();
                } catch (e) {
                    isError = true;
                }
                if (isError) {
                    this.closeRequest();
                    return;
                }
                
                console.log("Pair request accepted.");
                this.dispatchEvent(new CustomEvent("join"));
                return;
            };
            
        };
        
        const JoinDialog = class extends EventTarget {
            constructor() {
                super();
                this.overlay = document.getElementById("dialog-overlay");
                this.dialog = document.getElementById("dialog-room-joining");
                this.closeBtn = document.getElementById("btn-room-joining-close");
                this.infoText = document.getElementById("dialog-room-joining-info");
                this.loadingBar = document.getElementById("room-joining-progress");

                this.startTime = 0;
                this.timeout = 10000;
                this.loadingInterval = -1;
                this.cancelPromise = undefined;
            };
            open = () => {
                this.overlay.classList.add("active");
                this.dialog.classList.add("active");
                this.closeBtn.addEventListener("click", this.cancelRequest);
                //this.overlay.addEventListener("click", this.cancelRequest);
                server.addEventListener("pair-reject", this.rejectRequest);
                server.addEventListener("pair-accept", this.acceptRequest);

                this.startTime = Date.now();
                this.loadingInterval = setInterval(() => {
                    const progress = (Date.now() - this.startTime) / this.timeout * 10000;
                    this.loadingBar.value = progress;
                }, 16);
            };
            close = () => {
                this.overlay.classList.remove("active");
                this.dialog.classList.remove("active");
                this.closeBtn.removeEventListener("click", this.cancelRequest);
                this.overlay.removeEventListener("click", this.cancelRequest);
                server.removeEventListener("pair-reject", this.rejectRequest);
                server.removeEventListener("pair-accept", this.acceptRequest);
                clearInterval(this.loadingInterval);
            };
            setInit(ip, timeout) {
                let infoText = localization.get("new.join.dialog-info");
                infoText = localization.putParameters(infoText, new Map([
                    ["ipAddress", ip],
                ]));
                this.infoText.innerHTML = infoText;
                this.timeout = timeout;
            };
            cancelRequest = async () => {
                if (this.cancelPromise !== undefined) {
                    return;
                }
                this.cancelPromise = server.pairReject();
                await this.cancelPromise;
                this.cancelPromise = undefined;
                this.dispatchEvent(new CustomEvent("close", {
                    "detail": {
                        "type": "cancel"
                    }
                }));
            };
            rejectRequest = async () => {
                this.dispatchEvent(new CustomEvent("close", {
                    "detail": {
                        "type": "reject"
                    }
                }));
            };
            acceptRequest = async () => {
                console.log("Pair request accepted.");
                this.dispatchEvent(new CustomEvent("join"));
            };
        };

        this.createDialog = new CreateDialog();
        this.joinDialog = new JoinDialog();

        this.screen = document.getElementById("screen-new");
        this.joinBtn = document.getElementById("btn-new-join");
        this.joinLoading = document.getElementById("join-load");
        this.codeInput = document.getElementById("input-new-code");
        this.codeInputError = document.getElementById("join-error-text");
        this.createBtn = document.getElementById("btn-new-create");

        this.joinBtn.addEventListener("click", async () => {
            this.codeInput.parentElement.classList.remove("invalid");
            const code = this.codeInput.value.trim();

            this.joinLoad(true);
            let req;
            try {
                req = await server.pairRequest(code);
                console.log("Pair request accepted:", req);
            } catch (e) {

            }
            this.joinLoad(false);

            if (req === undefined) {
                console.log("Pair request accepted:", req);
                this.codeInput.parentElement.classList.add("invalid");
                this.codeInputError.innerText = localization.get("new.join.code-invalid");
                return;
            }

            this.joinDialog.setInit(req["ip"], req["timeout"]);
            this.dispatchEvent(new CustomEvent("dialog", {
                "detail": {
                    "dialog": this.joinDialog
                }
            }));
            
        });
        this.joinDialog.addEventListener("close", () => {
            const detail = event.detail;
            const type = detail["type"];
            if (type === "reject") {
                this.codeInput.parentElement.classList.add("invalid");
                this.codeInputError.innerText = localization.get("new.join.code-rejected");
            }
            this.dispatchEvent(new CustomEvent("dialog", {
                "detail": {
                    "dialog": undefined
                }
            }));
        });
        this.joinDialog.addEventListener("join", () => {
            this.dispatchEvent(new CustomEvent("join"));
        });

        this.createBtn.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("dialog", {
                "detail": {
                    "dialog": this.createDialog
                }
            }));
        });
        this.createDialog.addEventListener("close", () => {
            this.dispatchEvent(new CustomEvent("dialog", {
                "detail": {
                    "dialog": undefined
                }
            }));
        });
        this.createDialog.addEventListener("join", () => {
            this.dispatchEvent(new CustomEvent("join"));
        });
    };
    open = () => {
        this.screen.classList.remove("hide");
        this.codeInput.parentElement.classList.remove("invalid");
        
        this.joinLoad(false);
    };
    close = () => {
        this.screen.classList.add("hide");
        this.dispatchEvent(new CustomEvent("dialog", {
            "detail": {
                "dialog": undefined
            }
        }));

        this.codeInput.value = "";
        this.joinLoad(false);
    };

    joinLoad(isOn) {
        if (isOn) {
            this.codeInput.parentElement.classList.add("prefix");
            this.joinLoading.classList.remove("hide");
            this.codeInput.disabled = true;
        } else {
            this.codeInput.parentElement.classList.remove("prefix");
            this.joinLoading.classList.add("hide");
            this.codeInput.disabled = false;
        }
    }
};

const DownloadsScreen = class extends EventTarget {
    constructor() {
        super();
        this.screen = document.getElementById("screen-downloads");

        this.win32 = document.getElementById("download-win32");
        this.darwin = document.getElementById("download-darwin");
        this.linux = document.getElementById("download-linux");
        this.win32.addEventListener("click", () => {
            this.selectOS("win32");
        });
        this.darwin.addEventListener("click", () => {
            this.selectOS("darwin");
        });
        this.linux.addEventListener("click", () => {
            this.selectOS("linux");
        });

        this.x64 = document.getElementById("download-x64");
        this.x86 = document.getElementById("download-x86");
        this.arm64 = document.getElementById("download-arm64");
        this.arm32 = document.getElementById("download-arm32");
        this.x64.addEventListener("click", () => {
            this.selectArch("x64");
        });
        this.x86.addEventListener("click", () => {
            this.selectArch("x86");
        });
        this.arm64.addEventListener("click", () => {
            this.selectArch("arm64");
        });
        this.arm32.addEventListener("click", () => {
            this.selectArch("arm32");
        });

        this.downloadBtn = document.getElementById("download-finish");
        this.downloadBtn.addEventListener("click", () => {
            const downloadLink = document.createElement("a");
            const packageName = this.os + "-" + this.arch + ".zip";
            downloadLink.href = "./downloads/" + packageName;
            downloadLink.download = packageName;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
        });

        this.list = new Map();
        const clients = environment.server["clients"];
        for (let client of clients) {
            this.addClient(client);
        }

        this.os = environment.getOS();
        this.osElement = undefined;
        this.arch = undefined;
        this.archElement = undefined;

        // select default os
        if (this.list.has(this.os) === false) {
            this.os = this.list?.keys()?.next()?.value;
        }
        if (this.os !== undefined) {
            this.selectOS(this.os);
        }
        
    };
    open = () => {
        this.screen.classList.remove("hide");
    };
    close = () => {
        this.screen.classList.add("hide");
    };
    selectOS(os) {
        this.osElement?.classList?.add("border");
        if (os === "win32") {
            this.osElement = this.win32;
        } else if (os === "darwin") {
            this.osElement = this.darwin;
        } else if (os === "linux") {
            this.osElement = this.linux;
        }
        this.osElement?.classList?.remove("border");
        this.os = os;

        let arch = environment.getArch();
        if (this.list.has(os) === false) {
            arch = this.list.get(os).values().next().value;
        }
        const archs = this.list.get(os);
        if (archs.has("x64") === true) {
            this.x64.classList.remove("hide");
        } else {
            this.x64.classList.add("hide");
        }
        if (archs.has("x86") === true) {
            this.x86.classList.remove("hide");
        } else {
            this.x86.classList.add("hide");
        }
        if (archs.has("arm64") === true) {
            this.arm64.classList.remove("hide");
        } else {
            this.arm64.classList.add("hide");
        }
        if (archs.has("arm32") === true) {
            this.arm32.classList.remove("hide");
        } else {
            this.arm32.classList.add("hide");
        }
        this.selectArch(arch);
    };
    selectArch(arch) {
        this.archElement?.classList?.add("border");
        if (arch === "x64") {
            this.archElement = this.x64;
        } else if (arch === "x86") {
            this.archElement = this.x86;
        } else if (arch === "arm64") {
            this.archElement = this.arm64;
        } else if (arch === "arm32") {
            this.archElement = this.arm32;
        }
        this.archElement?.classList?.remove("border");
        this.arch = arch;
    };
    addClient(name) {
        name = name.split(".");
        name.pop();
        name = name.join(".");
        name = name.split("-");
        const os = name[0];
        const arch = name[1];
        if (this.list.has(os) === false) {
            this.list.set(os, new Set());
            if (os === "win32") {
                this.win32.classList.remove("hide");
            } else if (os === "darwin") {
                this.darwin.classList.remove("hide");
            } else if (os === "linux") {
                this.linux.classList.remove("hide");
            }
        }
        this.list.get(os).add(arch);
    };
};

const RoomScreen = class extends EventTarget {
    constructor() {
        super();
        this.navLeft = document.getElementById("nav-left");
        this.navTop = document.getElementById("nav-top");
        this.main = document.getElementById("screen-main");
        this.screen = document.getElementById("screen-room");
        this.loading = document.getElementById("room-loading");

        this.toolbarPeer = document.getElementById("room-toolbar-peer");
        this.toolbarHost = document.getElementById("room-toolbar-host");
        
        this.videoCanvas = document.getElementById("room-video");
        this.videoCanvas.getContext("webgpu");
        this.videoCanvasFocus = false;
        this.videoCanvas2 = document.getElementById("room-video-2");
        this.videoCanvas3 = document.getElementById("room-video-3");
        this.videoCanvas3.getContext("webgpu");
        this.exitBtn = document.getElementById("room-exit");

        // exiting
        const ExitDialog = class extends EventTarget {
            constructor() {
                super();
                this.overlay = document.getElementById("dialog-overlay");
                this.el = document.getElementById("dialog-room-exit");
                this.confirmBtn = document.getElementById("btn-room-exit-confirm");
                this.cancelBtn = document.getElementById("btn-room-exit-cancel");
                this.cancelBtn2 = document.getElementById("btn-room-exit-cancel-2");
            };
            open = () => {
                this.overlay.classList.add("active");
                this.el.classList.add("active");
                this.confirmBtn.addEventListener("click", this.confirm);
                this.cancelBtn.addEventListener("click", this.cancel);
                this.cancelBtn2.addEventListener("click", this.cancel);
            };
            close = () => {
                this.overlay.classList.remove("active");
                this.el.classList.remove("active");
                this.confirmBtn.removeEventListener("click", this.confirm);
                this.cancelBtn.removeEventListener("click", this.cancel);
                this.cancelBtn2.removeEventListener("click", this.cancel);
                
            };
            confirm = () => {
                this.dispatchEvent(new CustomEvent("confirm"));
            };
            cancel = () => {
                this.dispatchEvent(new CustomEvent("cancel"));
            };
        };
        this.exitDialog = new ExitDialog();
        this.exitBtn.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("dialog", {
                "detail": {
                    "dialog": this.exitDialog
                }
            }));
        });
        this.exitDialog.addEventListener("confirm", () => {
            this.dispatchEvent(new CustomEvent("dialog", {
                "detail": {
                    "dialog": undefined
                }
            }));
            this.exitRequest();
        });
        this.exitDialog.addEventListener("cancel", () => {
            this.dispatchEvent(new CustomEvent("dialog", {
                "detail": {
                    "dialog": undefined
                }
            }));
        });

        this.isStarted = false;

        // host (for browser)
        this.permissionBtn = document.getElementById("room-host-permission");
        this.permissionBtn.addEventListener("click", this.permissionRequest.bind(this));

        // peer
        this.bitrate = "0";
        this.resolution = "0";
        this.framerate = "0";
        this.framerateValue = 15;
        document.querySelectorAll(".room-bitrate").forEach((el) => {
            el.addEventListener("click", () => {
                document.querySelector(".room-bitrate[data-value='" + this.bitrate + "'] > i").innerHTML = "";
                this.bitrate = el.getAttribute("data-value");
                document.querySelector(".room-bitrate[data-value='" + this.bitrate + "'] > i").innerHTML = "check";
                console.log("Set bitrate to", this.bitrate);
                this.startVideo();
            });
        });
        document.querySelectorAll(".room-resolution").forEach((el) => {
            el.addEventListener("click", () => {
                document.querySelector(".room-resolution[data-value='" + this.resolution + "'] > i").innerHTML = "";
                this.resolution = el.getAttribute("data-value");
                document.querySelector(".room-resolution[data-value='" + this.resolution + "'] > i").innerHTML = "check";
                console.log("Set resolution to", this.resolution);
                this.startVideo();
            });
        });
        document.querySelectorAll(".room-framerate").forEach((el) => {
            el.addEventListener("click", () => {
                document.querySelector(".room-framerate[data-value='" + this.framerate + "'] > i").innerHTML = "";
                this.framerate = el.getAttribute("data-value");
                document.querySelector(".room-framerate[data-value='" + this.framerate + "'] > i").innerHTML = "check";
                console.log("Set framerate to", this.framerate);
                this.startVideo();
                if (this.framerate === "0") {
                    this.framerateValue = 15;
                } else if (this.framerate === "1") {
                    this.framerateValue = 30;
                } else if (this.framerate === "2") {
                    this.framerateValue = 60;
                }
            });
        });

        this.mute = "1";
        document.querySelector(".room-audio").addEventListener("click", () => {
            if (this.mute === "0") {
                this.mute = "1";
                document.querySelector(".room-audio > i").innerHTML = "volume_off";
            } else {
                this.mute = "0";
                document.querySelector(".room-audio > i").innerHTML = "volume_up";
            }
            server.webRTC.setAudio(this.mute);
        });

        this.enchate1 = false;
        this.enchate2 = false;
        this.enchate3 = false;
        this.frames = [];
        document.querySelectorAll(".room-enchante").forEach((el) => {
            el.addEventListener("click", async () => {
                const value = el.getAttribute("data-value");
                if (value === "0") {
                    if (this.enchate1 === true) {
                        this.enchate1 = false;
                        document.querySelector(".room-enchante[data-value='0'] > i").innerHTML = "";
                    } else {
                        this.enchate1 = true;
                        document.querySelector(".room-enchante[data-value='0'] > i").innerHTML = "check";
                    }
                } else if (value === "1") {
                    if (this.enchate2 === true) {
                        this.enchate2 = false;
                        document.querySelector(".room-enchante[data-value='1'] > i").innerHTML = "";
                        
                    } else {
                        document.querySelector(".room-enchante[data-value='1'] > i").innerHTML = "check";
                        for (let frame of this.frames) {
                            frame.dispose();
                        }
                        this.frames = [];
                        this.frames.push(await tf.browser.fromPixels(this.videoCanvas2));
                        this.frames.push(await tf.browser.fromPixels(this.videoCanvas2));
                        this.genFrame = await tf.browser.fromPixels(this.videoCanvas2);
                        this.then = 0;
                        this.isProcessing = false;
                        this.isRealFrameNext = true;
                        this.enchate2 = true;
                    }
                } else if (value === "2") {
                    if (this.enchate3 === true) {
                        this.enchate3 = false;
                        document.querySelector(".room-enchante[data-value='2'] > i").innerHTML = "";
                    } else {
                        
                        document.querySelector(".room-enchante[data-value='2'] > i").innerHTML = "check";
                        for (let frame of this.frames) {
                            frame.dispose();
                        }
                        this.frames = [];
                        this.frames.push(await tf.browser.fromPixels(this.videoCanvas2));
                        this.frames.push(await tf.browser.fromPixels(this.videoCanvas2));
                        this.genFrame = await tf.browser.fromPixels(this.videoCanvas2);
                        this.then = 0;
                        this.isProcessing = false;
                        this.isRealFrameNext = true;
                        this.enchate3 = true;
                    }
                }
            });
        });
        this.enchanteLoop = null;
        

        this.isFullscreen = false;
        this.escapeTimeout = null;
        document.querySelector(".room-fullscreen").addEventListener("click", () => {
            if (environment.desktop.isAvailable === true) {
                this.enterDesktopFullscreen();
            } else {
                this.videoCanvas.requestFullscreen();
            }
            
        });
        
        // for debug
        globalThis.exitDialog = this.exitDialog;
    };
    open = () => {
        this.setClosePrevention(true);
        this.navLeft.classList.add("hide");
        this.navTop.classList.add("hide");
        this.main.classList.add("hide");
        this.screen.classList.remove("hide");

        if (server.hostCode !== "" && environment.desktop.isAvailable === false) {
            this.toolbarPeer.classList.add("hide");
            this.toolbarHost.classList.remove("hide");
        }

        if (server.peerCode !== "") {
            this.toolbarPeer.classList.remove("hide");
            this.toolbarHost.classList.add("hide");
        }

        server.addEventListener("join-disconnect", this.waitForConnection);
        server.addEventListener("join-delete", this.exitRequest);
        this.waitForConnection();

        window.addEventListener("keydown", this.handleFullscreenKeyDown);
        window.addEventListener("keyup", this.handleFullscreenKeyUp);
    };
    close = () => {
        cancelAnimationFrame(this.enchanteLoop);
        this.setClosePrevention(false);
        this.navLeft.classList.remove("hide");
        this.navTop.classList.remove("hide");
        this.main.classList.remove("hide");
        this.screen.classList.add("hide");

        this.isStarted = false;

        server.removeEventListener("join-disconnect", this.waitForConnection);
        server.removeEventListener("join-delete", this.exitRequest);
        server.removeEventListener("join-connect", this.openConnection);
        server.webRTC?.removeEventListener("icon", this.setIcon);
        this.videoCanvas.removeEventListener("mousemove", this.moveMouse);
        this.videoCanvas.removeEventListener("mousedown", this.downMouse);
        this.videoCanvas.removeEventListener("mouseup", this.upMouse);
        this.videoCanvas.removeEventListener("wheel", this.wheelMouse);
        this.videoCanvas.removeEventListener("contextmenu", this.contextMenu);
        
        window.removeEventListener("mousedown", this.checkFocus);

        window.removeEventListener("keydown", this.downKey);
        window.removeEventListener("keyup", this.upKey);

        window.removeEventListener("keydown", this.handleFullscreenKeyDown);
        window.removeEventListener("keyup", this.handleFullscreenKeyUp);
        
        if (this.isFullscreen) {
            this.exitDesktopFullscreen();
        }
    };
    exitRequest = () => {
        this.dispatchEvent(new CustomEvent("exit"));
    };
    async permissionRequest() {
        console.log("Requesting permissions...");
    };
    setClosePrevention(isPrevented) {
        if (isPrevented) {
            window.addEventListener("beforeunload", this.closePreventHandler);
        } else {
            window.removeEventListener("beforeunload", this.closePreventHandler);
        }
    };
    closePreventHandler(event) {
        event.preventDefault();
        event.returnValue = true;
    };

    waitForConnection = async () => {
        this.loading.classList.remove("hide");
        if (server.hostCode !== "") {
            if (this.isStarted === false) {
                this.isStarted = true;
                await server.joinRequest();
                this.openConnection();
            } else {
                server.addEventListener("join-connect", this.openConnection);
            }
        }

        if (server.peerCode !== "") {
            if (server.webRTC === null || server.webRTC.isOpen === false) {
                server.addEventListener("join-request", this.openConnection);
            } else {
                this.openConnection();
            }
        }
    };
    openConnection = () => {
        if (server.peerCode !== "") {
            this.startVideo();
            server.webRTC.setAudio(this.mute);
            server.webRTC.addEventListener("icon", this.setIcon);
            this.videoCanvas.addEventListener("mousemove", this.moveMouse);
            this.videoCanvas.addEventListener("mousedown", this.downMouse);
            this.videoCanvas.addEventListener("mouseup", this.upMouse);
            this.videoCanvas.addEventListener("wheel", this.wheelMouse, { "passive": false });
            this.videoCanvas.addEventListener("contextmenu", this.contextMenu);
            window.addEventListener("mousedown", this.checkFocus);

            window.addEventListener("keydown", this.downKey);
            window.addEventListener("keyup", this.upKey);
            this.videoCanvas.focus();
        }
        this.loading.classList.add("hide");
        console.log("Connection opened.");
    };
    setIcon = (event) => {
        //console.log("Received new icon data:", event.detail);
        const icon = event.detail;
        
        // Ensure dimensions are valid
        if (icon.width > 0 && icon.height > 0) {
            const scaleFactor = icon.scaleFactor || 1;
            
            // Create a temporary canvas for the original image
            const originalCanvas = document.createElement("canvas");
            originalCanvas.width = icon.width;
            originalCanvas.height = icon.height;
            const originalCtx = originalCanvas.getContext("2d");
            
            // Create ImageData from the RGBA Uint8Array
            const imgData = new ImageData(
                new Uint8ClampedArray(icon.data), 
                icon.width, 
                icon.height
            );
            
            // Draw the pixel data to the original canvas
            originalCtx.putImageData(imgData, 0, 0);

            // Calculate scaled dimensions
            const scaledWidth = Math.max(1, Math.round(icon.width / scaleFactor));
            const scaledHeight = Math.max(1, Math.round(icon.height / scaleFactor));
            const scaledXOffset = Math.round(icon.xOffset / scaleFactor);
            const scaledYOffset = Math.round(icon.yOffset / scaleFactor);

            // Create a secondary canvas for the scaled image
            const scaledCanvas = document.createElement("canvas");
            scaledCanvas.width = scaledWidth;
            scaledCanvas.height = scaledHeight;
            const scaledCtx = scaledCanvas.getContext("2d");

            // Draw the original canvas onto the scaled canvas
            scaledCtx.drawImage(originalCanvas, 0, 0, scaledWidth, scaledHeight);
            
            // Export to base64 PNG Data URL
            const dataUrl = scaledCanvas.toDataURL("image/png");
            //console.log("Generated scaled cursor data URL:", dataUrl);

            // Set the cursor style on the video element with the scaled hotspot offset
            document.getElementById("room-video").style.cursor = `url(${dataUrl}) ${scaledXOffset} ${scaledYOffset}, auto`;
        } else {
            // Fallback to default or hide cursor if no valid icon
            document.getElementById("room-video").style.cursor = "auto";
        }
    };
    moveMouse = (event) => {
        if (this.videoCanvasFocus === false) {
            return;
        }
        const rect = this.videoCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
                    
        // Clamp values between 0.0 and 1.0 (in case the mouse goes slightly off-bounds)
        const relativeX = Math.max(0, Math.min(1, x));
        const relativeY = Math.max(0, Math.min(1, y));
        
        //console.log(`Mouse moved relative - x: ${relativeX.toFixed(3)}, y: ${relativeY.toFixed(3)}`);
        server.webRTC.setMousePos(relativeX, relativeY);
    };
    getMouseButton = (buttonCode) => {
        switch (buttonCode) {
            case 0: return "left";
            case 1: return "middle";
            case 2: return "right";
            case 3: return "back";
            case 4: return "forward";
            default: return null;
        }
    };

    downMouse = (event) => {
        event.preventDefault();
        const button = this.getMouseButton(event.button);
        if (!button) {
            return;
        };

        console.log(`Mouse down - button: ${button}`);
        server.webRTC.setMouseButton(button, "down");
    };
    
    upMouse = (event) => {
        event.preventDefault()
        const button = this.getMouseButton(event.button);
        if (!button) return;

        console.log(`Mouse up - button: ${button}`);
        server.webRTC.setMouseButton(button, "up");
    };

    wheelMouse = (event) => {
        // Prevent the page from scrolling when zooming/scrolling on the canvas
        event.preventDefault(); 
        
        const amount = Math.abs(event.deltaY);
        let state = "";
        
        if (event.deltaY > 0) {
            state = "down";
        } else if (event.deltaY < 0) {
            state = "up";
        }
        
        if (state !== "") {
            console.log(`Mouse wheel - state: ${state}, amount: ${amount}`);
            server.webRTC.setMouseWheel(state, amount);
        }
    };
    contextMenu = (event) => {
        event.preventDefault(); // Prevents the right-click menu from showing
    };

    checkFocus = (event) => {
        if (event.target === this.videoCanvas) {
            this.videoCanvasFocus = true;
        } else {
            this.videoCanvasFocus = false;
        }
    };
    downKey = (event) => {
        if (this.videoCanvasFocus === false) {
            return;
        }
        event.preventDefault();
        console.log(`Key down - code: ${event.code}`);
        server.webRTC.setKeyboard(event.code, "down");
    };
    upKey = (event) => {
        if (this.videoCanvasFocus === false) {
            return;
        }
        event.preventDefault();
        console.log(`Key up - code: ${event.code}`);
        server.webRTC.setKeyboard(event.code, "up");
    };
    enterDesktopFullscreen = () => {
        if (!this.isFullscreen) {
            this.isFullscreen = true;
            environment.desktop.ipcRenderer.invoke("api", "set-fullscreen", true);
            
            // Hide toolbars
            this.toolbarPeer.classList.add("hide");
            this.toolbarHost.classList.add("hide");
            
            // Show only video canvas by making it fixed and on top
            this.videoCanvas.style.position = "fixed";
            this.videoCanvas.style.top = "0";
            this.videoCanvas.style.left = "0";
            this.videoCanvas.style.width = "100vw";
            this.videoCanvas.style.height = "100vh";
            this.videoCanvas.style.zIndex = "9999";
            this.videoCanvas.style.backgroundColor = "black";
        }
    };
    exitDesktopFullscreen = () => {
        if (this.isFullscreen) {
            this.isFullscreen = false;
            environment.desktop.ipcRenderer.invoke("api", "set-fullscreen", false);
            
            // Restore the active toolbar after exiting
            if (server.hostCode !== "" && environment.desktop.isAvailable === false) {
                this.toolbarHost.classList.remove("hide");
            }
            if (server.peerCode !== "") {
                this.toolbarPeer.classList.remove("hide");
            }
                
            // Reset video canvas styling
            this.videoCanvas.style.position = "";
            this.videoCanvas.style.top = "";
            this.videoCanvas.style.left = "";
            this.videoCanvas.style.width = "";
            this.videoCanvas.style.height = "";
            this.videoCanvas.style.zIndex = "";
            this.videoCanvas.style.backgroundColor = "";
        }
    };
    handleFullscreenKeyDown = (e) => {
        if (e.key === "Escape" && this.isFullscreen) {
            if (!this.escapeTimeout) {
                // Initialize progress UI dynamically if not exists
                if (!this.exitProgressContainer) {
                    this.exitProgressContainer = document.createElement("div");
                    this.exitProgressContainer.style.position = "fixed";
                    this.exitProgressContainer.style.bottom = "20px";
                    this.exitProgressContainer.style.left = "50%";
                    this.exitProgressContainer.style.transform = "translateX(-50%)";
                    this.exitProgressContainer.style.zIndex = "10000";
                    this.exitProgressContainer.style.display = "none";
                    this.exitProgressContainer.style.flexDirection = "column";
                    this.exitProgressContainer.style.alignItems = "center";
                    this.exitProgressContainer.style.gap = "8px";
                    this.exitProgressContainer.style.padding = "16px";
                    this.exitProgressContainer.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
                    this.exitProgressContainer.style.borderRadius = "8px";
                    this.exitProgressContainer.style.color = "white";

                    const text = document.createElement("div");
                    text.innerText = localization.get("room.fullscreen-exit");
                    text.style.fontFamily = "sans-serif";
                    
                    this.exitProgressBar = document.createElement("progress");
                    this.exitProgressBar.max = 400; // Represents 4 seconds (400 ticks of 10ms)
                    this.exitProgressBar.value = 0;
                    this.exitProgressBar.style.width = "200px";

                    this.exitProgressContainer.appendChild(text);
                    this.exitProgressContainer.appendChild(this.exitProgressBar);
                    document.body.appendChild(this.exitProgressContainer);
                }

                // Track time and animate
                this.escapeHoldTime = 0;
                this.escapeInterval = setInterval(() => {
                    this.escapeHoldTime += 10;
                    
                    // Show progress bar after 1 second (1000ms)
                    if (this.escapeHoldTime >= 1000) {
                        this.exitProgressContainer.style.display = "flex";
                        this.exitProgressBar.value = (this.escapeHoldTime - 1000) / 8;
                    }
                }, 10);

                // Set a 5-second combined hold timeout
                this.escapeTimeout = setTimeout(() => {
                    clearInterval(this.escapeInterval);
                    this.escapeInterval = undefined;
                    if (this.exitProgressContainer) {
                        this.exitProgressContainer.style.display = "none";
                    }
                    this.exitDesktopFullscreen();
                    this.escapeTimeout = undefined;
                }, 4000);
            }
        }
    };
    handleFullscreenKeyUp = (e) => {
        if (e.key === "Escape") {
            if (this.escapeTimeout) {
                clearTimeout(this.escapeTimeout);
                this.escapeTimeout = undefined;
                
                if (this.escapeInterval) {
                    clearInterval(this.escapeInterval);
                    this.escapeInterval = undefined;
                }
                
                if (this.exitProgressContainer) {
                    this.exitProgressContainer.style.display = "none";
                    this.exitProgressBar.value = 0;
                }
            }
        }
    };

    startVideo = () => {
        if (this.enchanteLoop) {
            cancelAnimationFrame(this.enchanteLoop);
        }
        this.enchanteLoop = requestAnimationFrame(this.processFrame);
        server.webRTC.setVideo(this.bitrate, this.framerate, this.resolution, this.videoCanvas2);
    };
    processFrame = async (now) => {
        // Continue the loop
        this.enchanteLoop = requestAnimationFrame(this.processFrame);

        if (!this.enchate1 && !this.enchate2 && !this.enchate3) {
            if (this.videoCanvas.width > 0 && this.videoCanvas.height > 0) {
                await enchanter.copyCanvas(this.videoCanvas2, this.videoCanvas);
            }
        } else {
            if (this.enchate1 && this.enchate2) {
                await enchanter.framegen(this.videoCanvas2, this.videoCanvas3);
                await enchanter.upscale(this.videoCanvas3, this.videoCanvas);
            } else if (this.enchate1) {
                await enchanter.upscale(this.videoCanvas2, this.videoCanvas);
                //console.log("Frame upscaled with Enchanter.");
            } else if (this.enchate2) {
                //console.log("Frame processed with Enchanter.");
                const fps = this.framerateValue * 2;

                // Has enough time passed for a 30 FPS video?
                if (now - this.lastRun < 1000 / fps) {
                    return;
                }

                // Prevent overlapping executions
                if (this.isProcessing) {
                    return;
                }
                this.isProcessing = true;

                // update last run time
                this.lastRun = now - ((now - this.lastRun) % (1000 / fps));

                // process frame (interpolation)
                if (this.isRealFrameNext) {
                    this.frames.shift().dispose();
                    const newRealFrame = await tf.browser.fromPixelsAsync(this.videoCanvas2);
                    this.frames.push(newRealFrame);

                    // draw current real frame
                    await tf.browser.draw(this.frames[0], this.videoCanvas);
                    //await enchanter.drawTensorToCanvas(frame, this.videoCanvas);

                    this.genFrame.dispose();
                    this.genFrame = await enchanter.framegen(this.frames[0], this.frames[1], this.videoCanvas);

                    this.isRealFrameNext = false;
                } else {
                    await tf.browser.draw(this.genFrame, this.videoCanvas);
                    //await enchanter.drawTensorToCanvas(this.genFrame, this.videoCanvas);
                    
                    this.isRealFrameNext = true;
                }

                this.isProcessing = false;

            } else if (this.enchate3) {
                //console.log("Frame processed with Enchanter.");
                const fps = this.framerateValue * 2;

                // Has enough time passed for a 30 FPS video?
                if (now - this.lastRun < 1000 / fps) {
                    return;
                }

                // Prevent overlapping executions
                if (this.isProcessing) {
                    return;
                }
                this.isProcessing = true;

                // update last run time
                this.lastRun = now - ((now - this.lastRun) % (1000 / fps));

                // process frame (extrapolation)
                if (this.isRealFrameNext) {

                    this.frames.shift().dispose();
                    const newRealFrame = await tf.browser.fromPixelsAsync(this.videoCanvas2);
                    this.frames.push(newRealFrame);

                    // draw current real frame
                    await tf.browser.draw(this.frames[this.frames.length - 1], this.videoCanvas);

                    this.genFrame.dispose();
                    this.genFrame = await enchanter.framegen2(this.frames[0], this.frames[1], this.videoCanvas);

                    this.isRealFrameNext = false;
                } else {
                    await tf.browser.draw(this.genFrame, this.videoCanvas);
                    this.genFrame.dispose();
                    
                    this.isRealFrameNext = true;
                }

                this.isProcessing = false;
            }
        }
                
        
    };
            
};



const MainUI = class {
    constructor() {

    };
    async load() {
        // load color theme
        globalThis.ui("theme", environment.configuration["color"]);
        // set light/dark
        await new Promise((resolve) => {
            setTimeout(() => {
                let mode = environment.configuration["mode"];
                if (mode === "auto") {
                    mode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                }
                globalThis.ui("mode", mode);
                resolve();
            }, 1);
        });
        // set language
        localization.setLang(environment.configuration["lang"]);
        localization.translate();

        // call desktop specific UI setup
        if (environment.desktop.isAvailable) {
            environment.desktop.ipcRenderer.invoke("api", "set-tray-text", localization.get("main.tray-open"), localization.get("main.tray-close"));
            environment.desktop.ipcRenderer.invoke("api", "set-close-text", localization.get("main.close-text"), localization.get("main.close-text-2"), localization.get("main.close-confirm"), localization.get("main.close-cancel"));
            environment.desktop.ipcRenderer.send("api", "set-tray", environment.configuration["minimizing"]);
        }

        // loading DOM components
        this.loadingDialog = new LoadingDialog();
        this.menuComponent = new MenuComponent();
        this.newScreen = new NewScreen();
        this.downloadsScreen = new DownloadsScreen();
        this.settingsDialog = new SettingsDialog();
        this.roomScreen = new RoomScreen();
        globalThis.roomScreen = this.roomScreen;

        // connect buttons to component calls
        this.dialog = this.loadingDialog;
        this.screen = this.newScreen;
        this.menuComponent.open();
        this.menuComponent.addEventListener("dialog", (event) => {
            this.dialogSwitch(event.detail.dialog);
        });
        this.menuComponent.addEventListener("btn-new", () => {
            console.log("new btn clicked");
            window.history.pushState({}, "", "/" + "new");
            this.screenSwitch(this.newScreen);
        });
        this.menuComponent.addEventListener("btn-downloads", () => {
            console.log("downloads btn clicked");
            window.history.pushState({}, "", "/" + "downloads");
            this.screenSwitch(this.downloadsScreen);
        });
        this.menuComponent.addEventListener("btn-settings", () => {
            this.dialogSwitch(this.settingsDialog);
        });

        this.settingsDialog.addEventListener("close", () => {
            this.dialogSwitch(undefined);
        });

        this.newScreen.addEventListener("dialog", (event) => {
            this.dialogSwitch(event.detail.dialog);
        });
        this.newScreen.addEventListener("join", () => {
            window.history.pushState({}, "", "/room");
            this.screenSwitch(this.roomScreen);
        });

        this.roomScreen.addEventListener("dialog", (event) => {
            this.dialogSwitch(event.detail.dialog);
        });
        this.roomScreen.addEventListener("exit", () => {
            server.joinDisconnect();
            window.history.pushState({}, "", "/");
            this.screenSwitch(this.newScreen);
        });

        // load path
        window.addEventListener("popstate", this.loadPath);

    };
    switchOnline() {
        this.dialogSwitch(undefined);
        this.loadPath();
    };
    switchOffline() {
        this.screenSwitch(undefined);
        this.dialogSwitch(this.loadingDialog);
    };
    dialogSwitch(newDialog) {
        if (this.dialog === newDialog) {
            return;
        }
        this.dialog?.close();
        this.dialog = newDialog;
        this.dialog?.open();
    };
    screenSwitch(newScreen) {
        if (this.screen === newScreen) {
            return;
        }
        console.log("switch screen");
        this.dialogSwitch(undefined);
        this.screen?.close();
        this.screen = newScreen;
        this.screen?.open();
    };
    loadPath = async () => {
        // prevent loading path if room
        if (this.screen === this.roomScreen) {
            window.history.pushState({}, "", "/room");
            return;
        }

        let path = window.location.pathname || "/";
        path = path.slice(1);
        path = path.split("/");

        if (path[0] === "new") {
            this.screenSwitch(this.newScreen);
            return;
        } else if (path[0] === "downloads") {
            if (environment.desktop.isAvailable || environment.server["clients"].length === 0) {
                window.history.pushState({}, "", "/");
                this.screenSwitch(this.newScreen);
                return;
            }
            this.screenSwitch(this.downloadsScreen);
            return;
        } else if (path[0] === "room") {
            try {
                await server.joinConnect();
            } catch (e) {
                window.history.pushState({}, "", "/");
                this.screenSwitch(this.newScreen);
                return;
            }
            this.screenSwitch(this.roomScreen);
            return;
        } else {
            window.history.pushState({}, "", "/");
            this.screenSwitch(this.newScreen);
            return;
        }
    };
};
const mainUI = new MainUI();
globalThis.mainUI = mainUI;

const main = async function() {
    // load environment (DOM, configuration, desktop libs, etc.)
    await environment.load();

    // load ML enchanter
    await enchanter.loadModels();

    // load visible components and switch by server connection
    await mainUI.load();
    server.addEventListener("online", () => {
        console.log("online");
        mainUI.switchOnline();
    });
    server.addEventListener("offline", () => {
        console.log("offline");
        mainUI.switchOffline();
    });

    // load server connection
    await server.load("wss://" + environment.server["domain"] + ":" + environment.server["ws"], environment.server["webRTCConfig"]);
};
main();