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
        this.DATABBASE = "desktop_streamer";
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
        await IDB.TableSet(this.DATABBASE, this.CONF_TABLE);
        const DB = await IDB.DatabaseGet(this.DATABBASE);
        const table = IDB.TableGet(DB, this.CONF_TABLE);

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
        result["exitShortcuts"] = JSON.parse(result["exitShortcuts"]);

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
            desktop["isAvailable"] = true;
            desktop["path"] = path;
            desktop["os"] = os;
            desktop["spawn"] = spawn;
            desktop["ipcRenderer"] = ipcRenderer;
            desktop["appPath"] = appPath;
            desktop["autoLaunch"] = new AutoLaunch({
                "name": "Desktop Streamer",
                "path": exePath
            });
            desktop["Control"] = Control;
            desktop["ffmpegPath"] = path.join(appPath, "libs/ffmpeg");
            desktop["FFmpegVideoEncoder"] = FFmpegEncoder["FFmpegVideoEncoder"];
            desktop["FFmpegAudioEncoder"] = FFmpegEncoder["FFmpegAudioEncoder"];

            // disable require to prevent security issues
            globalThis.require = undefined; // disable require for security reasons
        } else {
            desktop["isAvailable"] = false;
        }
        console.log(desktop);
        this.desktop = desktop;

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


    handleIncoming = (event) => {

    };

    // pairing
    pairCreate() {

    };
    pairRequest(pairCode) {
    
    };
    pairAccept() {

    };
    pairReject() {

    };

    // joining
    joinConnect(joinId, peerCode, hostCode) {

    };
    joinDisconnect(joinId) {

    };
};
const server = new Server();


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

const SettingsDialog = class extends EventTarget {
    constructor() {
        super();
    };
    open = () => {

    };
    close = () => {

    };
};

const NewShareDialog = class extends EventTarget {
    constructor() {
        super();
    };
    open = () => {

    };
    close = () => {

    };
};
const NewRequestDialog = class extends EventTarget {
    constructor() {
        super();
    };
    open = () => {

    };
    close = () => {

    };
};
const NewJoiningDialog = class extends EventTarget {
    constructor() {
        super();
    };
    open = () => {

    };
    close = () => {

    };
};
const NewLoadingDialog = class extends EventTarget {
    constructor() {
        super();
    };
    open = () => {

    };
    close = () => {

    };
};
const NewScreen = class extends EventTarget {
    constructor() {
        super();
    };
    open = () => {

    };
    close = () => {

    };
};

const DownloadsScreen = class extends EventTarget {
    constructor() {
        super();
    };
    open = () => {

    };
    close = () => {

    };
};

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

        // set event listeners
        this.closeBtn.addEventListener("click", this.triggerClose);
        this.newBtn.addEventListener("click", () => {
            this.triggerClose();
            this.dispatchEvent(new CustomEvent("btn-new"));
        });
        this.downloadsBtn.addEventListener("click", () => {
            this.triggerClose();
            this.dispatchEvent(new CustomEvent("btn-downloads"));
        });
    };
    open = () => {
        this.overlay.classList.add("active");
        this.dialog.classList.add("active");
        window.addEventListener("resize", this.resize);
        this.overlay.addEventListener("click", this.triggerClose);
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
};
const MenuComponent = class extends EventTarget {
    constructor() {
        super();
        // events: dialog, btn-new, btn-downloads, btn-settings
        this.menuDialog = new MenuDialog();
        this.menuDialog.addEventListener("close", () => {
            this.dispatchEvent(new CustomEvent("dialog", {
                "detail": {
                    "dialog": undefined
                }
            }));
        });

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

        // function buttons
        this.menuDialog.addEventListener("btn-new", () => {
            this.dispatchEvent(new CustomEvent("btn-new"));
        });
        this.newBtn.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("btn-new"));
        });
        this.menuDialog.addEventListener("btn-downloads", () => {
            this.dispatchEvent(new CustomEvent("btn-downloads"));
        });
        this.downloadsBtn.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("btn-downloads"));
        });
        this.settingsBtn.addEventListener("click", () => {
            this.dispatchEvent(new CustomEvent("btn-settings"));
        });

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
        if (enviroment.desktop["isAvailable"]) {
            desktop.ipcRenderer.invoke("api", "set-tray-text", localization.get("tray-open"), localization.get("tray-close"));
            desktop.ipcRenderer.send("api", "set-tray", enviroment.configuration["minimizing"]);
        }

        // loading DOM components
        this.loadingDialog = new LoadingDialog();
        this.menuComponent = new MenuComponent();
        this.newScreen = null;
        this.downloadsScreen = null;
        this.settingsDialog = null;

        

        // connect buttons to component calls
        this.dialog = this.loadingDialog;
        this.screen = this.newScreen;
        this.menuComponent.addEventListener("dialog", (event) => {
            this.dialogSwitch(event.detail.dialog);
        });
        this.menuComponent.addEventListener("btn-new", () => {
            console.log("new btn clicked");
        });
        this.menuComponent.addEventListener("btn-downloads", () => {
            console.log("downloads btn clicked");
        });
        this.menuComponent.addEventListener("btn-settings", () => {
            console.log("settings btn clicked");
        });

        // load path

    };
    switchOnline() {
        this.dialogSwitch(undefined);
    };
    switchOffline() {
        this.dialogSwitch(this.loadingDialog);
    };
    dialogSwitch(newDialog) {
        this.dialog?.close();
        this.dialog = newDialog;
        this.dialog?.open();
    };
    screeSwitch(newScreen) {
        this.screen?.close();
        this.screen = newScreen;
        this.screen?.open();
    };
};
const mainUI = new MainUI();


const main = async function() {
    // load enviroment (DOM, configuration, desktop libs, etc.)
    await enviroment.load();

    // load visible components
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