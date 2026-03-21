"use strict";

// import dependencies
import IDB from "./libs/idb/idb.js";
import Communicator from "./libs/communicator/communicator.js";
import {BrowserAudioEncoder} from "./libs/ffmpeg-chunkifier/encoder-browser.js";
import {Decoder, Player} from "./libs/ffmpeg-chunkifier/decoder.js";
import localization from "./localization.js";


// Configuration
// Task to load enviroment and essential data and desktop libs for the application.
const Enviroment = class {
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
const enviroment = new Enviroment();
globalThis.enviroment = enviroment;

// Server
// Handle API calls with WebSocket backend and WebRTC connection
const Server = class extends EventTarget {
    constructor() {
        super();
    };
    async load(address) {
        this.address = address;
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
            this.dispatchEvent(new CustomEvent("pair-accept", {
                "detail": {
                    "joinId": message["joinId"],
                    "peerCode": message["peerCode"]
                }
            }));
            return;
        }


        if (message["type"] === "join-connect") {
            this.dispatchEvent(new CustomEvent("join-connect"));
            return;
        }

        if (message["type"] === "join-disconnect") {
            this.dispatchEvent(new CustomEvent("join-disconnect"));
            return;
        }

        if (message["type"] === "join-delete") {
            this.dispatchEvent(new CustomEvent("join-delete"));
            return;
        }

        if (message["type"] === "join-request") {
            this.dispatchEvent(new CustomEvent("join-request"));
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
        return {
            "joinId": data["joinId"],
            "hostCode": data["hostCode"]
        };
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
    async joinConnect(joinId, peerCode, hostCode) {
        const startMsg = {
            "type": "join-connect",
            "joinId": joinId,
        };
        if (peerCode !== undefined) {
            startMsg["peerCode"] = peerCode;
        } else if (hostCode !== undefined) {
            startMsg["hostCode"] = hostCode;
        }
        const msg = this.communicator.invoke({
            "peerCode": peerCode,
            "hostCode": hostCode
        });
        await msg.wait();

    };
    async joinRequest() {
        
    };
    async joinDisconnect(joinId) {

    };
};
const server = new Server();
globalThis.server = server;

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
                if (enviroment.desktop.isAvailable || enviroment.server["clients"].length === 0) {
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
                window.addEventListener("resize", this.resize);
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
        if (enviroment.desktop.isAvailable || enviroment.server["clients"].length === 0) {
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
                    await enviroment.setDatabaseValue("lang", lang);
                    localization.setLang(lang);
                    localization.translate();
                    if (enviroment.desktop.isAvailable) {
                        enviroment.desktop.ipcRenderer.send("api", "set-lang", lang);
                    }
                });

                // theme settings
                this.themeBtn = document.getElementById("btn-appearance-theme");
                this.themeBtn.addEventListener("click", async () => {
                    if (enviroment.configuration["mode"] === "auto") {
                        enviroment.configuration["mode"] = "light";
                    } else if (enviroment.configuration["mode"] === "light") {
                        enviroment.configuration["mode"] = "dark";
                    } else {
                        enviroment.configuration["mode"] = "auto";
                    }
                    let mode = enviroment.configuration["mode"];
                    if (mode === "auto") {
                        mode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                    }
                    globalThis.ui("mode", mode);
                    this.setThemeIcon();
                    await enviroment.setDatabaseValue("mode", enviroment.configuration["mode"]);
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
                if (enviroment.desktop.isAvailable) {
                    this.trayLabel.classList.remove("hide");
                    this.trayCheckbox.checked = enviroment.configuration["minimizing"];
                    this.trayCheckbox.addEventListener("change", async (event) => {
                        const isChecked = event.target.checked;
                        enviroment.configuration["minimizing"] = isChecked;
                        enviroment.desktop.ipcRenderer.send("api", "set-tray", isChecked);
                        await enviroment.setDatabaseValue("minimizing", isChecked);
                    });
                } else {
                    this.trayError.classList.remove("hide");
                }

                // auto lanunch
                this.autoLaunchLabel = document.getElementById("label-auto-launch");
                this.autoLaunchCheckbox = document.getElementById("checkbox-auto-launch");
                this.autoLaunchError = document.getElementById("error-auto-launch");
                if (enviroment.desktop.isAvailable) {
                    this.autoLaunchLabel.classList.remove("hide");
                    console.log(enviroment.desktop.autoLaunch);
                    enviroment.desktop.autoLaunch.isEnabled().then((isEnabled) => {
                        this.autoLaunchCheckbox.checked = isEnabled;
                    });
                    this.autoLaunchCheckbox.addEventListener("change", async (event) => {
                        const isChecked = event.target.checked;
                        if (isChecked) {
                            await enviroment.desktop.autoLaunch.enable();
                        } else {
                            await enviroment.desktop.autoLaunch.disable();
                        }
                        const isEnabled = await enviroment.desktop.autoLaunch.isEnabled();
                        event.target.checked = isEnabled;
                        enviroment.configuration["autoLaunch"] = isEnabled;
                        await enviroment.setDatabaseValue("autoLaunch", isEnabled);
                    });

                } else {
                    this.autoLaunchError.classList.remove("hide");
                }
            };
            open = () => {
                this.langSelect.value = enviroment.configuration["lang"];
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
                if (enviroment.configuration["mode"] === "auto") {
                    this.themeBtn.children[0].innerText = "hdr_auto";
                } else if (enviroment.configuration["mode"] === "light") {
                    this.themeBtn.children[0].innerText = "light_mode";
                } else {
                    this.themeBtn.children[0].innerText = "dark_mode";
                }
            };
            async setColor(color) {
                globalThis.ui("theme", color);
                await enviroment.setDatabaseValue("color", color);
            };
        };

        const AudioTab = class {
            constructor() {
                this.win = document.getElementById("settings-audio");
                this.btn = document.getElementById("btn-settings-audio");
                const browser = enviroment.checkBrowser();

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
                if (enviroment.desktop.isAvailable) {
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
                if (enviroment.desktop.isAvailable) {
                    this.listDisplay = async () => {
                        const screens = enviroment.desktop.Control.Screen.list();
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
                            console.log("Decoded video frame:", frame);
                            try {
                                await writer.write(frame);
                            } catch (e) {
                                console.error("Failed to write frame:", e);
                            } finally {
                                frame.close();
                            }
                        };
                        this.videoEncoderFFmpeg = new enviroment.desktop.FFmpegVideoEncoder();
                        this.videoEncoderFFmpeg.onConfiguration = (config) => {
                            console.log("Video configuration:", config);
                            this.decoder.appendVideoConfiguration(config);
                        };
                        this.videoEncoderFFmpeg.onChunk = (chunk) => {
                            console.log("Video chunk:", chunk);
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
                        if (enviroment.desktop.os.platform() === "win32") {
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
                            enviroment.desktop.ffmpegPath,
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
                if (enviroment.desktop.isAvailable) {
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
                await enviroment.setDatabaseValue("exitShortcuts", JSON.stringify(shortcutObj));
            };
            open = () => {
                // add browser specific shortcuts
                if (enviroment.desktop.isAvailable === true) {
                    this.addShortcut("5", ["ESC"], false);
                } else {
                    this.addShortcut("1", ["ESC"], false);
                    this.addShortcut("1", ["F11"], false);
                }

                // add user defined shortcut
                this.shortcuts = [];
                const loadedShortcuts = JSON.parse(enviroment.configuration["exitShortcuts"]);
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

                const browser = enviroment.checkBrowser();

                this.version = document.getElementById("about-version");
                this.version.innerText = "0.1.0";

                this.supported = document.getElementById("about-supported");
                let isMissing = false;

                // check autolaunch support
                this.autoLanuch = document.getElementById("about-auto-launch");
                if (enviroment.desktop.isAvailable === false) {
                    isMissing = true;
                    this.autoLanuch.classList.remove("hide");
                }

                // check tray support
                this.tray = document.getElementById("about-tray");
                if (enviroment.desktop.isAvailable === false) {
                    isMissing = true;
                    this.tray.classList.remove("hide");
                }

                // check system audio share support
                this.systemAudio = document.getElementById("about-audio");
                this.systemAudio2 = document.getElementById("about-audio-unsupported");
                if (enviroment.desktop.isAvailable === false) {
                    isMissing = true;
                    if (browser["isChrome"] || browser["isOpera"] || browser["isEdgeChromium"]) {
                        this.systemAudio.classList.remove("hide");
                    } else {
                        this.systemAudio2.classList.remove("hide");
                    }
                }

                // check screen share support
                this.screenShare = document.getElementById("about-screen");
                if (enviroment.desktop.isAvailable === false) {
                    isMissing = true;
                    this.screenShare.classList.remove("hide");
                }

                // check play support
                this.playback = document.getElementById("about-play");
                if (enviroment.desktop.isAvailable === false && (typeof VideoDecoder === "undefined" || typeof AudioDecoder === "undefined")) {
                    isMissing = true;
                    this.playback.classList.remove("hide");
                }

                // check control share support
                this.controlShare = document.getElementById("about-control");
                if (enviroment.desktop.isAvailable === false) {
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
                this.overlay.addEventListener("click", this.triggerClose);

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
            closeRequest = (event) => {
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
                try {
                    await server.pairReject();
                } catch (e) {
                    
                }
                this.closeRequest();
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
                this.overlay.addEventListener("click", this.cancelRequest);
                server.addEventListener("pair-reject", this.rejectRequest);

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
    };
    open = () => {
        this.screen.classList.remove("hide");
        this.codeInput.parentElement.classList.remove("invalid");
        
        this.joinLoad(false);
    };
    close = () => {
        this.screen.classList.add("hide");

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
        const clients = enviroment.server["clients"];
        for (let client of clients) {
            this.addClient(client);
        }

        this.os = enviroment.getOS();
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

        let arch = enviroment.getArch();
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



 

const MainUI = class {
    constructor() {

    };
    async load() {
        // load color theme
        globalThis.ui("theme", enviroment.configuration["color"]);
        // set light/dark
        await new Promise((resolve) => {
            setTimeout(() => {
                let mode = enviroment.configuration["mode"];
                if (mode === "auto") {
                    mode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                }
                globalThis.ui("mode", mode);
                resolve();
            }, 1);
        });
        // set language
        localization.setLang(enviroment.configuration["lang"]);
        localization.translate();

        // call desktop specific UI setup
        if (enviroment.desktop.isAvailable) {
            enviroment.desktop.ipcRenderer.invoke("api", "set-tray-text", localization.get("tray-open"), localization.get("tray-close"));
            enviroment.desktop.ipcRenderer.send("api", "set-tray", enviroment.configuration["minimizing"]);
        }

        // loading DOM components
        this.loadingDialog = new LoadingDialog();
        this.menuComponent = new MenuComponent();
        this.newScreen = new NewScreen();
        this.downloadsScreen = new DownloadsScreen();
        this.settingsDialog = new SettingsDialog();

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

        // load path
        window.addEventListener("popstate", this.loadPath);

    };
    switchOnline() {
        this.dialogSwitch(undefined);
        this.loadPath();
    };
    switchOffline() {
        this.dialogSwitch(this.loadingDialog);
    };
    dialogSwitch(newDialog) {
        this.dialog?.close();
        this.dialog = newDialog;
        this.dialog?.open();
    };
    screenSwitch(newScreen) {
        console.log("switch screen");
        this.dialogSwitch(undefined);
        this.screen?.close();
        this.screen = newScreen;
        this.screen?.open();
    };
    loadPath = () => {
        let path = window.location.pathname || "/";
        path = path.slice(1);
        path = path.split("/");

        if (path[0] === "new") {
            this.screenSwitch(this.newScreen);
        } else if (path[0] === "downloads") {
            if (enviroment.desktop.isAvailable || enviroment.server["clients"].length === 0) {
                window.history.pushState({}, "", "/");
                this.screenSwitch(this.newScreen);
                return;
            }
            this.screenSwitch(this.downloadsScreen);
        } else {
            this.screenSwitch(this.newScreen);
        }
    };
};
const mainUI = new MainUI();


const main = async function() {
    // load enviroment (DOM, configuration, desktop libs, etc.)
    await enviroment.load();

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
    await server.load("wss://" + enviroment.server["domain"] + ":" + enviroment.server["ws"]);
};
main();