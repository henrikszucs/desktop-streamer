"use strict";

// load dependencies
import conf from "./conf.js";
import IDB from "./libs/idb/idb.js";
import Communicator from "./libs/communicator/communicator.js";


// enviroment variables
const isDesktop = (typeof globalThis.desktop !== "undefined");
const width = window.innerWidth;
const sizeS = 600;
const sizeM = 993;

// Load local configuration from disk
const confLoad = new Promise(async function(resolve) {
    await IDB.TableSet("desktop_streamer", "configuration");
    const db = await IDB.DatabaseGet("desktop_streamer");
    const table = IDB.TableGet(db, "configuration");
    const res = await IDB.RowGet(table, [["color", "#006e1c"], ["mode", "light"]]);
    resolve({
        "color": res[0],
        "mode": res[1]
    });
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
            await this.communicator.sideSync();
            await this.communicator.timeSync();
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
    }
};
const server = new Server("wss://" + conf["ws"]["domain"] + ":" + conf["ws"]["port"]);


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

const SettingsDialog = class {
    constructor() {
        // get important elements
        this.overlay = document.getElementById("dialog-overlay");
        this.settingsBtn = document.getElementById("btn-settings");
        this.settingsDialog = document.getElementById("dialog-settings");
        this.settingsClose = document.getElementById("btn-settings-close");
        

        // set event listeners
        this.settingsClose.addEventListener("click", () => {
            this.close();
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

const WelcomeScreen = class {
    constructor() {
        // get important elements
        this.welcomeScreen = document.getElementById("screen-welcome");
    };
    open = () => {
        this.welcomeScreen.classList.remove("hide");
    };
    close = () => {
        this.welcomeScreen.classList.add("hide");
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
        this.downloadScreen = document.getElementById("screen-download");
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
            const file = selectedOs + "-" + selectedArch + ".zip";
            console.log("Download client:", file);
            //window.open(location.href + file, "_blank");
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

const RegisterScreen = class {
    constructor() {
        // get important elements
        this.registerScreen = document.getElementById("screen-register");
    };
    open = () => {
        this.registerScreen.classList.remove("hide");
    };
    close = () => {
        this.registerScreen.classList.add("hide");
    };
};

const PasswordResetScreen = class {
    constructor() {
        // get important elements
        this.passwordResetScreen = document.getElementById("screen-password");
    };
    open = () => {
        this.passwordResetScreen.classList.remove("hide");
    };
    close = () => {
        this.passwordResetScreen.classList.add("hide");
    };
};

const SharesScreen = class {
    constructor() {
        // get important elements
        this.sharesScreen = document.getElementById("screen-shares");
    };
    open = () => {
        this.sharesScreen.classList.remove("hide");
    };
    close = () => {
        this.sharesScreen.classList.add("hide");
    };
};

const RoomsScreen = class {
    constructor() {
        // get important elements
        this.roomsScreen = document.getElementById("screen-rooms");
    };
    open = () => {
        this.roomsScreen.classList.remove("hide");
    };
    close = () => {
        this.roomsScreen.classList.add("hide");
    };
};

const RoomScreen = class {
    constructor() {
        // get important elements
        this.roomScreen = document.getElementById("screen-room");
        this.navTop = document.getElementById("nav-top");
        this.navBottom = document.getElementById("nav-bottom");
        this.navLeft = document.getElementById("nav-left");
        this.navRoom = document.getElementById("nav-room");
    };
    open = () => {
        this.roomScreen.classList.remove("hide");
        this.navRoom.classList.remove("hide");
        this.navTop.classList.add("hide");
        this.navBottom.classList.add("hide");
        this.navLeft.classList.add("hide");
    };
    close = () => {
        this.roomScreen.classList.add("hide");
        this.navRoom.classList.add("hide");
        this.navTop.classList.remove("hide");
        this.navBottom.classList.remove("hide");
        this.navLeft.classList.remove("hide");
        
    };
};


// Main logic
const main = async function() {
    const val = await Promise.all([confLoad, domReady]);
    conf["local"] = val[0];
    console.log(conf);

    // Dialog and screen management
    const emptyDialog = new EmptyDialog();
    let openedDialog = emptyDialog;
    let openedScreen = null;
    const switchScreen = function(newScreen) {
        switchDialog(emptyDialog);
        openedScreen.close();
        openedScreen = downloadScreen;
        openedScreen.open();
    };
    const switchDialog = function(newDialog) {
        openedDialog.close();
        openedDialog = newDialog;
        openedDialog.open();
    };
    
    
    
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

    // Welcome screen
    const welcomeScreen = new WelcomeScreen();

    // Download screen
    const downloadScreen = new DownloadScreen(conf["http"]["clients"]);
    downloadScreen.downloadBtn.addEventListener("click", () => {
        window.history.pushState({}, "", "/" + "downloads");
        loadPath();
    });

    // Login screen
    const loginScreen = new LoginScreen();

    // Register screen
    const registerScreen = new RegisterScreen();

    // Password reset screen
    const passwordResetScreen = new PasswordResetScreen();

    // Shares screen
    const sharesScreen = new SharesScreen();

    // Rooms screen
    const roomsScreen = new RoomsScreen();

    // Room screen
    const roomScreen = new RoomScreen();

    


    

    const addBtn = document.getElementById("btn-add");
    const addBtn2 = document.getElementById("btn-add-2");

    const roomsBtn = document.getElementById("btn-clients");
    const roomsBtn2 = document.getElementById("btn-clients-2");

    const sharesBtn = document.getElementById("btn-shares");
    const sharesBtn2 = document.getElementById("btn-shares-2");
    



    
    
    // Side menu toggle
    const menuBtn = document.getElementById("btn-menu");
    if (sizeS < width) {
        if (width < sizeM) {
            menuBtn.parentElement.parentElement.classList.remove("max");
        } else {
            menuBtn.parentElement.parentElement.classList.add("max");
        }
    }
    menuBtn.addEventListener("click", function (event) {
        event.target.parentElement.parentElement.classList.toggle("max");
    });

    
    // Load the given URL path
    const loadPath = function() {
        let path = window.location.pathname || "/";
        path = path.slice(1);
        path = path.split("/");

        const singleRoutes = ["welcome", "downloads", "shares", "login", "register", "password-reset"];
        const doubleRoutes = ["room", "rooms", "search"];
        if (singleRoutes.includes(path[0])) {
            path = [path[0]];
        } else if (doubleRoutes.includes(path[0])) {
            path = [path[0], path[1]];
        } else {
            path = [""];
        }
        window.history.replaceState({}, "", "/" + path.join("/"));


        // load screens
        if (path[0] === "downloads") {
            switchScreen(downloadScreen);
        } else {

        }
    };
    window.addEventListener("popstate", loadPath);
    loadPath();
    
    

    // Loading
    let loadingDialog = new LoadingDialog();
    if (server.isOnline) {
        loadingDialog.close();
    }
    server.addEventListener("online", loadingDialog.close);
    server.addEventListener("offline", loadingDialog.open);
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