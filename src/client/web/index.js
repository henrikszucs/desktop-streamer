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

// Load configuration from disk
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


// Main logic
const main = async function() {
    const val = await Promise.all([confLoad, domReady]);
    conf["local"] = val[0];
    console.log(conf);
    
    // get important elements
    const overlay = document.getElementById("dialog-overlay");

    const loading = document.getElementById("dialog-loading");

    const navTop = document.getElementById("nav-top");
    const navBottom = document.getElementById("nav-bottom");
    const navLeft = document.getElementById("nav-left");

    const searchInput = document.getElementById("input-search");
    const searchInputMenu = document.getElementById("input-search-menu");
    const searchInputTrue = document.getElementById("input-search-true");
    const searchInputFinish = document.getElementById("input-search-finish");
    const searchBtn = document.getElementById("btn-search");
    const searchDialog = document.getElementById("dialog-search");
    const searchInput2 = document.getElementById("input-search-2");
    const searchInput2True = document.getElementById("input-search-2-true");
    const searchInput2Finish = document.getElementById("input-search-2-finish");

    const settingsBtn = document.getElementById("btn-settings");
    const settingsDialog = document.getElementById("dialog-settings");
    const settingsClose = document.getElementById("btn-settings-close");

    const downloadBtn = document.getElementById("btn-download");
    const downloadSreen = document.getElementById("screen-download");

    const menuBtn = document.getElementById("btn-menu");
    const welcomeScreen = document.getElementById("screen-welcome");

    const addBtn = document.getElementById("btn-add");
    const addBtn2 = document.getElementById("btn-add-2");
    const addScreen = document.getElementById("screen-add");
    

    const clientsBtn = document.getElementById("btn-clients");
    const clientsBtn2 = document.getElementById("btn-clients-2");

    const sharesBtn = document.getElementById("btn-shares");
    const csharesBtn2 = document.getElementById("btn-shares-2");

    

    let openedScreen = null;

    // Download
    if (isDesktop) {
        downloadBtn.classList.add("hide");
        // check update
        const checkUpdate = async function() {

        };
        
    } else {
        downloadBtn.addEventListener("click", function (event) {
            openedScreen?.classList.add("hide");
            downloadSreen.classList.remove("hide");
            openedScreen = downloadSreen;
        });
    }
    



    // Side menu toggle
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


    // Search input
    searchInput.addEventListener("click", function (event) {
        searchInputTrue.focus();
    });
    searchInput2.addEventListener("click", function (event) {
        searchInput2True.focus();
    });

    const search = function() {
        console.log("Search input:", searchInput.value);
    };
    
    const spreadSearchInput = function(event) {
        const value = event.target.value;
        searchInput.value = value;
        searchInputTrue.value = value;
        searchInput2.value = value;
        searchInput2True.value = value;
    };
    searchInputTrue.addEventListener("input", spreadSearchInput);
    searchInput2True.addEventListener("input", spreadSearchInput);

    let searchDialogMethods = (function() {
        return {
            "show": function() {
                overlay.classList.add("active");
                searchDialog.classList.add("active");
                searchInput2True.focus();
                overlay.addEventListener("click", searchDialogMethods.hide);
            },
            "hide": function() {
                searchInput2.blur();
                searchInput2True.blur();
                overlay.classList.remove("active");
                searchDialog.classList.remove("active");
                overlay.removeEventListener("click", searchDialogMethods.hide);
            }
        };
    })();
    searchBtn.addEventListener("click", function (event) {
        searchDialogMethods.show();
    });
    searchInputTrue.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            searchInputTrue.blur();
            search(event);
        }
    });
    searchInput2True.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            searchDialogMethods.hide();
            search(event);
        }
    });
    searchInputFinish.addEventListener("click", function (event) {
        search();
    });
    searchInput2Finish.addEventListener("click", function (event) {
        searchDialogMethods.hide();
        search();
    });
    
    
    // Settings
    const settingsDialogMethods = (function() {
        return {
            "show": function() {
                overlay.classList.add("active");
                settingsDialog.classList.add("active");
                overlay.addEventListener("click", settingsDialogMethods.hide);
            },
            "hide": function() {
                overlay.classList.remove("active");
                settingsDialog.classList.remove("active");
                overlay.removeEventListener("click", settingsDialogMethods.hide);
            }
        };
    })();
    settingsBtn.addEventListener("click", function (event) {
        settingsDialogMethods.show();
    });
    settingsClose.addEventListener("click", function (event) {
        settingsDialogMethods.hide();
    });



    // path check
    const path = window.location.pathname || "/";
    if (path.startsWith("/download")) {

    } else if (path.startsWith("/settings")) {

    } else {

    }

    

    // Loading
    let loadingDialog = (function() {
        return {
            "show": function() {
                loading.classList.add("active");
                overlay.classList.add("blur");
                overlay.classList.add("active");
            },
            "hide": function() {
                loading.classList.remove("active");
                overlay.classList.remove("blur");
                overlay.classList.remove("active");
            }
        };
    })();
    if (server.isOnline) {
        loadingDialog.hide();
    }
    server.addEventListener("online", loadingDialog.hide);
    server.addEventListener("offline", loadingDialog.show);
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