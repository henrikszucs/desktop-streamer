"use strict";

// load dependencies
import IDB from "./libs/idb/idb.js";
import Communicator from "./libs/communicator/communicator.js";

//load configuration
import conf from "./conf.js";
import localization from "./localization.js";



// enviroment variables
const isDesktop = (typeof globalThis.desktop !== "undefined");
const width = window.innerWidth;
const sizeS = 600;
const sizeM = 993;

// Load local configuration from disk
const DATABBASE = "desktop_streamer";
const CONF_TABLE = "configuration";
let DB = null;
const confLoad = new Promise(async function(resolve) {
    await IDB.TableSet(DATABBASE, CONF_TABLE);
    DB = await IDB.DatabaseGet(DATABBASE);
    const table = IDB.TableGet(DB, CONF_TABLE);

    // key and their default values
    const vals = {
        "color": "#006e1c",
        "mode": "light",
        "lang": "auto",
        "sessionId": ""
    };

    // load values from database
    const keys = Object.keys(vals);
    const search = [];
    for (let key of keys) {
        search.push([key, vals[key]]);
    }
    const res = await IDB.RowGet(table, search);
    const result = {};
    let i = 0;
    for (let i = 0, length = keys.length; i < length; i++) {
        result[keys[i]] = res[i];
    }

    resolve(result);
});


// Wait for the DOM to be ready
const domReady = new Promise(function (resolve) {
    window.addEventListener("load", () => {
        resolve();
    }, { "once": true });
});


// Server connection
const Server = class extends EventTarget {
    address = "";
    ws = null;
    communicator = null;
    isOnline = false;
    constructor(address) {
        super();
        //events: online / offline
        this.communicator = new Communicator({
            "sender": function() {},
            "interactTimeout": 3000,    //the max timeout between two packet arrive
        
            "timeout": 5000,            //the time for transmit message
            "packetSize": 1000,         //the maximum size of one packet in bytes (only for ArrayBuffer)
            "packetTimeout": 1000,      //the max timeout for packets
            "packetRetry": Infinity,    //number of retring attemts for one packet
            "sendThreads": 16
        });

        this.connect(address);
    };
    connect(address = this.address) {
        this.ws?.close?.();
        
        //create connection
        this.address = address;
        this.ws = new WebSocket(this.address);
        this.ws.binaryType = "arraybuffer";

        // configure sernder fn
        this.communicator.configure({
            "sender": async (data) => {
                if ((data instanceof ArrayBuffer) === false) {
                    data = JSON.stringify(data);
                }
                this.ws.send(data);
            }
        });

        // configure receiver fn
        this.ws.addEventListener("message", (event) => {
            console.log("Received data:", event.data);
            let data = event.data;
            if (typeof data === "string") {
                data = JSON.parse(data);
            }
            this.communicator.receive(data);
        });

        //connection status
        this.ws.addEventListener("open", async () => {
            // sync
            await this.communicator.sideSync();
            await this.communicator.timeSync();

            // get server conf
            try {
                const message = this.communicator.invoke({"type":"conf-get"});
                await message.wait();
                conf["ws"]["remote"] = message.data;
            } catch (error) {
                console.error("Failed to get server configuration:", error);
                this.ws.close();
                return;
            }
            if (typeof conf["ws"]["remote"] === "undefined") {
                this.ws.close();
                return;
            }

            // trigger online
            console.log("connected");
            this.dispatchEvent(new CustomEvent("online"));
            this.isOnline = true;
        }, { "once": true });
        this.ws.addEventListener("error", () => {
            console.log("disconnected");
            this.dispatchEvent(new CustomEvent("offline"));
            this.isOnline = false;
        }, { "once": true });
        this.ws.addEventListener("close", () => {
            console.log("closed");
            this.dispatchEvent(new CustomEvent("offline"));
            this.isOnline = false;
            setTimeout(() => {
                this.connect();
            }, 2000);
        }, { "once": true });
    };
    async authGoogle(credential) {
        const message = this.communicator.invoke({"type":"login-google", "credential": credential});
        await message.wait();
        console.log(message.data);
        return message.data;
    };
};
globalThis.server = new Server("wss://" + conf["ws"]["domain"] + ":" + conf["ws"]["port"]);


// UI classes
const EmptyDialog = class {
    constructor() {
        // get important elements
    };
    open = () => {
        // open dialog
    };
    close = () => {
        // close dialog
    };
};

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

const SearchDialog = class extends EventTarget {
    constructor() {
        super();

        // get important elements
        this.overlay = document.getElementById("dialog-overlay");
        this.searchInput = document.getElementById("input-search");
        this.searchInputMenu = document.getElementById("input-search-menu");
        this.searchInputTrue = document.getElementById("input-search-true");
        this.searchInputFinish = document.getElementById("input-search-finish");
        this.searchDialog = document.getElementById("dialog-search");
        this.searchInput2 = document.getElementById("input-search-2");
        this.searchInput2Menu = document.getElementById("input-search-2-menu");
        this.searchInput2True = document.getElementById("input-search-2-true");
        this.searchInput2Finish = document.getElementById("input-search-2-finish");

        // set passive behavior
        // common value for all input elements
        this.searchInput.addEventListener("click", () => {
            this.searchInputTrue.focus();
        });
        this.searchInput2.addEventListener("click", () => {
            this.searchInput2True.focus();
        });
        this.searchInputTrue.addEventListener("input", this.spreadSearchInput);
        this.searchInput2True.addEventListener("input", this.spreadSearchInput);


        // finish of search input
        this.searchInputTrue.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.searchInputTrue.blur();
                this.triggerSearch();
            }
        });
        this.searchInput2True.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.close();
                this.triggerSearch();
            }
        });
        this.searchInputFinish.addEventListener("click", () => {
            this.triggerSearch();
        });
        this.searchInput2Finish.addEventListener("click", () => {
            this.close();
            this.triggerSearch();
        });
    };
    open = () => {
        this.overlay.classList.add("active");
        this.searchDialog.classList.add("active");
        this.searchInput2True.focus();
        this.overlay.addEventListener("click", this.close);
    };
    close = () => {
        this.searchInput2.blur();
        this.searchInput2True.blur();
        this.overlay.classList.remove("active");
        this.searchDialog.classList.remove("active");
        this.overlay.removeEventListener("click", this.close);
    };
    spreadSearchInput = (event) => {
        const value = event.target.value;
        this.searchInput.value = value;
        this.searchInputTrue.value = value;
        this.searchInput2.value = value;
        this.searchInput2True.value = value;
    };
    triggerSearch() {
        this.dispatchEvent(new CustomEvent("search", {
            "detail": {
                "value": this.searchInput.value
            }
        }));
    };
};

const MenuDialog = class {
    constructor() {
        // get important elements
        this.overlay = document.getElementById("dialog-overlay");
        this.dialog = document.getElementById("dialog-menu");
        this.closeBtn = document.getElementById("btn-menu-close");

        // set event listeners
        this.closeBtn.addEventListener("click", () => {
            this.close();
        });
    };
    open = () => {
        this.overlay.classList.add("active");
        this.dialog.classList.add("active");
        this.overlay.addEventListener("click", this.close);
    };
    close = () => {
        this.overlay.classList.remove("active");
        this.dialog.classList.remove("active");
        this.overlay.removeEventListener("click", this.close);
    };
};

const SettingsDialog = class {
    constructor() {
        // get important elements
        this.overlay = document.getElementById("dialog-overlay");
        this.settingsBtn = document.getElementById("btn-settings");
        this.settingsDialog = document.getElementById("dialog-settings");
        this.settingsClose = document.getElementById("btn-settings-close");

        this.currentScreen = document.getElementById("settings-appearance");
        this.currentBtn = document.getElementById("btn-settings-appearance");
        const addScreen = (btn, screen) => {
            btn.addEventListener("click", (event) => {
                if (this.currentScreen !== screen) {
                    this.currentScreen.classList.add("hide");
                    screen.classList.remove("hide");
                    this.currentScreen = screen;

                    this.currentBtn.classList.remove("primary");
                    this.currentBtn.classList.add("fill");
                    btn.classList.add("primary");
                    btn.classList.remove("fill");
                    this.currentBtn = btn;
                }
            });
        };
        addScreen(document.getElementById("btn-settings-appearance"), document.getElementById("settings-appearance"));
        addScreen(document.getElementById("btn-settings-audio"), document.getElementById("settings-audio"));
        addScreen(document.getElementById("btn-settings-video"), document.getElementById("settings-video"));
        addScreen(document.getElementById("btn-settings-control"), document.getElementById("settings-control"));
        addScreen(document.getElementById("btn-settings-about"), document.getElementById("settings-about"));
        
        // set event listeners
        this.settingsClose.addEventListener("click", () => {
            this.close();
        });

        // Appearance settings
        const themeBtn = document.getElementById("btn-appearance-theme");
        const setThemeIcon = () => {
            console.log("Set theme icon:", globalThis.ui("mode"));
            if (globalThis.ui("mode") === "dark") {
                themeBtn.children[0].innerText = "dark_mode";
            } else {
                themeBtn.children[0].innerText = "light_mode";
            }
        };
        const setColor = async (color) => {
            globalThis.ui("theme", color);

            const r = Number("0x"+color.slice(1,3));
            const g = Number("0x"+color.slice(3,5));
            const b = Number("0x"+color.slice(5,7));
            const isNeedDark = 0.2126 * r + 0.7152 * g + 0.0722 * b > 127;

            const newMode = isNeedDark ? "dark" : "light";
            setTimeout(() => {
                globalThis.ui("mode", newMode);
                setThemeIcon();
            }, 1);

            conf["local"]["color"] = color;
            conf["local"]["mode"] = newMode;
            await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["color", color], ["mode", newMode]]);
        };
        themeBtn.addEventListener("click", async () => {
            const newMode = globalThis.ui("mode") === "dark" ? "light" : "dark";
            globalThis.ui("mode", newMode);
            setThemeIcon();
            conf["local"]["mode"] = newMode;
            await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["mode", newMode]])
        });
        setThemeIcon();
        document.getElementById("btn-appearance-theme-color").addEventListener("change", (event) => {
            const color = event.target.value;
            setColor(color);
        });
        document.getElementById("btn-appearance-theme-green").addEventListener("click", (event) => {
            setColor("#006e1c");
        });
        document.getElementById("btn-appearance-theme-red").addEventListener("click", (event) => {
            setColor("#f44336");
        });
        document.getElementById("btn-appearance-theme-pink").addEventListener("click", (event) => {
            setColor("#e91e63");
        });
        document.getElementById("btn-appearance-theme-purple").addEventListener("click", (event) => {
            setColor("#9c27b0");
        });
        document.getElementById("btn-appearance-theme-indigo").addEventListener("click", (event) => {
            setColor("#3f51b5");
        });
        document.getElementById("btn-appearance-theme-blue").addEventListener("click", (event) => {
            setColor("#2196f3");
        });
        document.getElementById("btn-appearance-theme-yellow").addEventListener("click", (event) => {
            setColor("#ffeb3b");
        });
        document.getElementById("btn-appearance-theme-orange").addEventListener("click", (event) => {
            setColor("#ff9800");
        });

        const langSelect = document.getElementById("select-appearance-lang");
        langSelect.value = conf["local"]["lang"];
        langSelect.addEventListener("change", async (event) => {
            let lang = event.target.value;
            if (lang !== "auto" && localization.supportedLanguages.indexOf(lang) === -1) {
                lang = "auto";
            }
            conf["local"]["lang"] = lang;
            await IDB.RowSet(IDB.TableGet(DB, CONF_TABLE), [["lang", lang]]);
            
            if (lang === "auto") {
                lang = (navigator.language || navigator.userLanguage).substring(0,2);
            }
            if (localization.supportedLanguages.indexOf(lang) === -1) {
                lang = "en";
            }
            localization.translate(lang);
            
        });
    };
    open = () => {
        this.overlay.classList.add("active");
        this.settingsDialog.classList.add("active");
        this.overlay.addEventListener("click", this.close);
    };
    close = () => {
        this.overlay.classList.remove("active");
        this.settingsDialog.classList.remove("active");
        this.overlay.removeEventListener("click", this.close);
    };
};

const AccountDialog = class {
    constructor() {
        // get important elements
        this.overlay = document.getElementById("dialog-overlay");
        this.accountDialog = document.getElementById("dialog-account");
        this.accountClose = document.getElementById("btn-account-close");

        // set event listeners
        this.accountClose.addEventListener("click", () => {
            this.close();
        });
    };
    open = () => {
        this.overlay.classList.add("active");
        this.accountDialog.classList.add("active");
        this.overlay.addEventListener("click", this.close);
    };
    close = () => {
        this.overlay.classList.remove("active");
        this.accountDialog.classList.remove("active");
        this.overlay.removeEventListener("click", this.close);
    };
};

const NewScreen = class {
    constructor() {
        // get important elements
        this.newScreen = document.getElementById("screen-new");
    };
    open = () => {
        this.newScreen.classList.remove("hide");
    };
    close = () => {
        this.newScreen.classList.add("hide");
    };
};

const DownloadScreen = class {
    constructor(clientList) {
        // convert client list to map
        this.clients = new Map();
        for (let client of clientList) {
            client = client.slice(0, client.lastIndexOf("."));
            client = client.split("-");
            let clientSet = this.clients.get(client[0]);
            if (clientSet === undefined) {
                const newClientSet = new Set();
                this.clients.set(client[0], newClientSet);
                clientSet = newClientSet;
            }
            clientSet.add(client[1]);
        }

        // get important elements
        this.downloadBtn = document.getElementById("btn-download");
        this.downloadScreen = document.getElementById("screen-downloads");
        this.downloadWindows = document.getElementById("download-win32");
        this.downloadMacos = document.getElementById("download-macos");
        this.downloadLinux = document.getElementById("download-linux");
        this.downloadx64 = document.getElementById("download-x64");
        this.downloadx86 = document.getElementById("download-x86");
        this.downloadArm64 = document.getElementById("download-arm64");
        this.downloadArm32 = document.getElementById("download-arm32");
        this.downloadFinish = document.getElementById("download-finish");

        // selection and initialization
        if (this.clients.has("win32") === false) {
            this.downloadWindows.classList.add("hide");
        }
        if (this.clients.has("macos") === false) {
            this.downloadMacos.classList.add("hide");
        }
        if (this.clients.has("linux") === false) {
            this.downloadLinux.classList.add("hide");
        }
        this.lastOsChoice = this.downloadWindows;
        this.lastArchChoice = this.downloadx64;
        this.selectedOs = "win32";
        this.selectedArch = "x64";
        this.displayChoice(this.getOS(), this.getArch());

        // set event listeners
        this.downloadWindows.addEventListener("click", () => {
            this.displayChoice("win32");
        });
        this.downloadMacos.addEventListener("click", () => {
            this.displayChoice("macos");
        });
        this.downloadLinux.addEventListener("click", () => {
            this.displayChoice("linux");
        });

        this.downloadx86.addEventListener("click", () => {
            this.displayChoice(undefined, "x86");
        });
        this.downloadx64.addEventListener("click", () => {
            this.displayChoice(undefined, "x64");
        });
        this.downloadArm64.addEventListener("click", () => {
            this.displayChoice(undefined, "arm64");
        });
        this.downloadArm32.addEventListener("click", () => {
            this.displayChoice(undefined, "arm32");
        });

        this.downloadFinish.addEventListener("click", () => {
            const file = this.selectedOs + "-" + this.selectedArch + ".zip";
            console.log("Download client:", file);
            window.open(location.href + file, "_blank");
        });
    };
    open = () => {
        this.downloadScreen.classList.remove("hide");
    };
    close = () => {
        this.downloadScreen.classList.add("hide");
    };
    displayChoice = (os, arch) => {
        // select OS
        if (os === undefined) {
            os = this.selectedOs;
        }
        let osSet = this.clients.get(os);
        if (osSet === undefined) {
            const iterator = clients.entries();
            const value = iterator.next();
            os = value.value[0];
            osSet = value.value[1];
        }
        let newOsChoice = null;
        if (os === "win32") {
            newOsChoice = this.downloadWindows;
        } else if (os === "macos") {
            newOsChoice = this.downloadMacos;
        } else if (os === "linux") {
            newOsChoice = this.downloadLinux;
        }
        if (newOsChoice !== this.lastOsChoice) {
            this.lastOsChoice.classList.add("border");
            newOsChoice.classList.remove("border");
            this.lastOsChoice = newOsChoice;
            this.selectedOs = os;

            if (osSet.has("x64") === false) {
                this.downloadx64.classList.add("hide");
            } else {
                this.downloadx64.classList.remove("hide");
            }
            if (osSet.has("x86") === false) {
                this.downloadx86.classList.add("hide");
            } else {
                this.downloadx86.classList.remove("hide");
            }
            if (osSet.has("arm64") === false) {
                this.downloadArm64.classList.add("hide");
            } else {
                this.downloadArm64.classList.remove("hide");
            }
            if (osSet.has("arm32") === false) {
                this.downloadArm32.classList.add("hide");
            } else {
                this.downloadArm32.classList.remove("hide");
            }
        }

        // select architecture
        if (arch === undefined) {
            arch = this.selectedArch;
        }
        if (osSet.has(arch) === false) {
            const iterator = osSet.values();
            arch = iterator.next().value;
        }
        let newArchChoice = null;
        if (arch === "x64") {
            newArchChoice = this.downloadx64;
        } else if (arch === "x86") {
            newArchChoice = this.downloadx86;
        } else if (arch === "arm64") {
            newArchChoice = this.downloadArm64;
        } else if (arch === "arm32") {
            newArchChoice = this.downloadArm32;
        }
        if (newArchChoice !== this.lastArchChoice) {
            this.lastArchChoice.classList.add("border");
            newArchChoice.classList.remove("border");
            this.lastArchChoice = newArchChoice;
            this.selectedArch = arch;
        }

    };
    indexOf(array, value) {
        for (let i = 0; i < array.length; i++) {
            if (value.indexOf(array[i]) !== -1) {
                return i;
            }
        }
        return -1;
    };
    getArch() {
        const userAgent = window.navigator.userAgent;
        const x64Platforms = ["x86_64", "AMD64", "x64"];
        const x86Platforms = ["i386", "i686", "x86"];
        const arm64Platforms = ["arm64", "aarch64"];
        const arm32Platforms = ["armv7l", "armv6l", "arm"];

        let arch = "unknown";

        if (this.indexOf(x64Platforms, userAgent) !== -1) {
            arch = "x64";
        } else if (this.indexOf(x86Platforms, userAgent) !== -1) {
            arch = "x86";
        } else if (this.indexOf(arm64Platforms, userAgent) !== -1) {
            arch = "arm64";
        } else if (this.indexOf(arm32Platforms, userAgent) !== -1) {
            arch = "arm32";
        }
        return arch;
    };
    getOS() {
        const userAgent = window.navigator.userAgent;
        const platform = window.navigator?.userAgentData?.platform || window.navigator.platform;
        const macosPlatforms = ["macOS", "Macintosh", "MacIntel", "MacPPC", "Mac68K"];
        const windowsPlatforms = ["Win32", "Win64", "Windows", "WinCE"];
        const iosPlatforms = ["iPhone", "iPad", "iPod"];
        let os = "unknown";

        if (macosPlatforms.indexOf(platform) !== -1) {
            os = "macos";
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

const LoginScreen = class {
    constructor() {
        // get important elements
        this.loginScreen = document.getElementById("screen-login");
    };
    open = () => {
        // open login screen
        this.loginScreen.classList.remove("hide");
    };
    close = () => {
        // close login screen
        this.loginScreen.classList.add("hide");
    };
};

const ServiceScreen = class {
    constructor() {
        // get important elements
        this.serviceScreen = document.getElementById("screen-services");
        this.serviceBtn = document.getElementById("btn-services");
        this.serviceBtn2 = document.getElementById("btn-services-2");
    };
    open = () => {
        this.serviceScreen.classList.remove("hide");
        this.serviceBtn.classList.add("active");
        this.serviceBtn2.classList.add("fill");
    };
    close = () => {
        this.serviceScreen.classList.add("hide");
        this.serviceBtn.classList.remove("active");
        this.serviceBtn2.classList.remove("fill");
    };
};

const DeviceScreen = class {
    constructor() {
        // get important elements
        this.deviceScreen = document.getElementById("screen-devices");
        this.deviceBtn = document.getElementById("btn-devices");
        this.deviceBtn2 = document.getElementById("btn-devices-2");
    };
    open = () => {
        this.deviceScreen.classList.remove("hide");
        this.deviceBtn.classList.add("active");
        this.deviceBtn2.classList.add("fill");
    };
    close = () => {
        this.deviceScreen.classList.add("hide");
        this.deviceBtn.classList.remove("active");
        this.deviceBtn2.classList.remove("fill");
    };
};

const OutgoingScreen = class {
    constructor() {
        // get important elements
        this.outgoingScreen = document.getElementById("screen-outgoings");
        this.outgoingBtn = document.getElementById("btn-outgoings");
        this.outgoingBtn2 = document.getElementById("btn-outgoings-2");
    };
    open = () => {
        this.outgoingScreen.classList.remove("hide");
        this.outgoingBtn.classList.add("active");
        this.outgoingBtn2.classList.add("fill");
    };
    close = () => {
        this.outgoingScreen.classList.add("hide");
        this.outgoingBtn.classList.remove("active");
        this.outgoingBtn2.classList.remove("fill");
    };
};

const RoomScreen = class {
    constructor() {
        // get important elements
        this.roomScreen = document.getElementById("screen-room");
        this.navTop = document.getElementById("nav-top");
        this.navLeft = document.getElementById("nav-left");
    };
    open = () => {
        this.roomScreen.classList.remove("hide");
        this.navTop.classList.add("hide");
        this.navLeft.classList.add("hide");
    };
    close = () => {
        this.roomScreen.classList.add("hide");
        this.navTop.classList.remove("hide");
        this.navLeft.classList.remove("hide");
        
    };
};



const GoogleLogin = class extends EventTarget {
    constructor(clientId) {
        super();

        // load google script if not already loaded
        const scriptSrc = "https://accounts.google.com/gsi/client";
        if (document.querySelector("head script[src=\"" + scriptSrc + "\"]") === null) {
            const googleScript = document.createElement("script");
            googleScript.setAttribute("src", scriptSrc);
            document.head.appendChild(googleScript);
        }

        // store client id
        this.clientId = clientId;

        // global callback function
        window.onGoogleLogin = async (response) => {
            //console.log(response);
            let res;
            try {
                res = await server.authGoogle(response.credential);
            } catch(err) {
                console.error("Google login failed");
            }
            /*console.log("https://oauth2.googleapis.com/tokeninfo?id_token=" + response.credential);
            const responsePayload = this.decodeJWT(response.credential);
            console.log(responsePayload);*/
            console.log(res);
            if (typeof res === "undefined") {
                return;
            }
            this.dispatchEvent(
                new CustomEvent("login", {"detail": response})
            );
        }
    };
    createButton(el) {
        el.innerHTML = "<div data-auto_prompt=false data-callback=onGoogleLogin data-client_id=" + this.clientId + " data-context=signin data-ux_mode=popup id=g_id_onload></div><div class=g_id_signin data-logo_alignment=left data-shape=pill data-size=large data-text=signin_with data-theme=filled_blue data-type=standard></div>";
    };
    decodeJWT(token) {
        let base64Url = token.split(".")[1];
        let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        let jsonPayload = decodeURIComponent(atob(base64).split("").map(function (c) {
                return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            }).join("")
        );
        return JSON.parse(jsonPayload);
    };
};



// Main logic
const main = async function() {
    const val = await Promise.all([confLoad, domReady]);
    conf["local"] = val[0];

    globalThis.localization = localization;

    // load local conf
    globalThis.ui("theme", conf["local"]["color"]);
    setTimeout(() => {
        globalThis.ui("mode", conf["local"]["mode"]);
    }, 1);
    console.log(conf);

    let lang = conf["local"]["lang"];
    if (lang === "auto") {
            lang = (navigator.language || navigator.userLanguage).substring(0,2);
    }
    if (localization.supportedLanguages.indexOf(lang) === -1) {
        lang = "en";
    }
    localization.translate(lang);

    // Search dialog
    const searchDialog = new SearchDialog();
    document.getElementById("btn-search").addEventListener("click", () => {
        openedDialog?.close();
        openedDialog = searchDialog;
        openedDialog.open();
    });
    searchDialog.addEventListener("search", (event) => {
        const value = event.detail.value;
        console.log("Search for:", value);
    });

    // Settings dialog
    const settingsDialog = new SettingsDialog();
    settingsDialog.settingsBtn.addEventListener("click", () => {
        switchDialog(settingsDialog);
    });

    // Account dialog
    const accountDialog = new AccountDialog();


    // New screen
    const newScreen = new NewScreen();
    document.getElementById("btn-new").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "new");
        loadPath();
    });
    document.getElementById("btn-new-2").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "new");
        loadPath();
    });

    // Download screen
    const downloadScreen = new DownloadScreen(conf["http"]["clients"]);
    document.getElementById("btn-download").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "downloads");
        loadPath();
    });
    document.getElementById("btn-download-2").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "downloads");
        loadPath();
    });

    // Login screen
    const loginScreen = new LoginScreen();
    document.getElementById("btn-login").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "login");
        loadPath();
    });
    
    // Rooms screen
    const serviceScreen = new ServiceScreen();
    document.getElementById("btn-services").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "services");
        loadPath();
    });
    document.getElementById("btn-services-2").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "services");
        loadPath();
    });

    // Devices screen
    const deviceScreen = new DeviceScreen();
    document.getElementById("btn-devices").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "devices");
        loadPath();
    });
    document.getElementById("btn-devices-2").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "devices");
        loadPath();
    });

    // Outgoings screen
    const outgoingScreen = new OutgoingScreen();
    document.getElementById("btn-outgoings").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "outgoings");
        loadPath();
    });
    document.getElementById("btn-outgoings-2").addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "outgoings");
        loadPath();
    });

    // Room screen
    const roomScreen = new RoomScreen();



    

    // Dialog and screen management
    const emptyDialog = new EmptyDialog();
    let openedDialog = emptyDialog;
    let openedScreen = newScreen;
    const switchScreen = function(newScreen) {
        switchDialog(emptyDialog);
        openedScreen.close();
        openedScreen = newScreen;
        openedScreen.open();
    };
    const switchDialog = function(newDialog) {
        openedDialog.close();
        openedDialog = newDialog;
        openedDialog.open();
    };

    
    
    // Side menu toggle
    const menuBtn = document.getElementById("btn-menu-left");
    let isMenuMax = false;
    const switchMenu = function(isMax = isMenuMax) {
        if (isMax) {
            menuBtn.parentElement.parentElement.classList.add("max");
            document.getElementById("btn-download").classList.add("primary");
            document.getElementById("btn-download").children[0].classList.remove("primary");
        } else {
            menuBtn.parentElement.parentElement.classList.remove("max");
            document.getElementById("btn-download").classList.remove("primary");
            document.getElementById("btn-download").children[0].classList.add("primary");
        }
    };
    if (sizeS < width) {
        if (width < sizeM) {
            isMenuMax = false;
            switchMenu();
        } else {
            isMenuMax = true;
            switchMenu();
        }
    }
    menuBtn.addEventListener("click", function (event) {
        isMenuMax = !isMenuMax;
        switchMenu();
    });
    const menuDialog = new MenuDialog();
    const menuBtn2 = document.getElementById("btn-menu-top");
    menuBtn2.addEventListener("click", function (event) {
        switchDialog(menuDialog);
    });
    window.addEventListener("resize", function() {
        const width = window.innerWidth;
        if (sizeS < width && openedDialog === menuDialog) {
            switchDialog(emptyDialog);
        };
    });


    
    // Load the given URL path
    const loadPath = function() {
        let path = window.location.pathname || "/";
        path = path.slice(1);
        path = path.split("/");

        const singleRoutes = ["new", "downloads", "outgoings", "login"];
        const doubleRoutes = ["services", "devices", "search", "room"];
        if (singleRoutes.includes(path[0])) {
            path = [path[0]];
        } else if (doubleRoutes.includes(path[0])) {
            path = [path[0], path[1]];
        } else {
            path = [""];
        }
        window.history.replaceState({}, "", "/" + path.join("/"));


        // load screens
        if (path[0] === "new") {
            switchScreen(newScreen);
        } else if (path[0] === "downloads") {
            switchScreen(downloadScreen);
        } else if (path[0] === "login") {
            switchScreen(loginScreen);
        } else if (path[0] === "services") {
            switchScreen(serviceScreen);
        } else if (path[0] === "devices") {
            switchScreen(deviceScreen);
        } else if (path[0] === "outgoings") {
            switchScreen(outgoingScreen);
        } else {
            switchScreen(newScreen);
        }
    };
    window.addEventListener("popstate", loadPath);
    
    

    // Loading
    let loadingDialog = new LoadingDialog();
    const switchOnline = function() {
        // prepare UI
        const serverConf = conf["ws"]["remote"];

        if (typeof serverConf["auth"]["google"] !== "undefined") {
            const googleLogin = new GoogleLogin(serverConf["auth"]["google"]["clientId"]);
            googleLogin.createButton(document.getElementById("google-login"));
            document.getElementById("google-login").classList.remove("hide");
        } else {
            document.getElementById("google-login").classList.add("hide");
        }

        loadingDialog.close();
        loadPath();
    };
    if (server.isOnline) {
        switchOnline();
    }
    server.addEventListener("online", switchOnline);
    server.addEventListener("offline", function() {
        loadingDialog.open();
    });
};
main();








// Theme and mode
const theme = function(color) {
    globalThis.ui("theme", color || "#006e1c");
};

const mode = function() {
    let newMode = globalThis.ui("mode") == "dark" ? "light" : "dark";
    globalThis.ui("mode", newMode);
};

const isNeedDarkFont = function(color="#006e1c") {
    const r = Number("0x"+color.slice(1,3))
    const g = Number("0x"+color.slice(3,5))
    const b = Number("0x"+color.slice(5,7))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 127;
};