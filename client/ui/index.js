"use strict";

const digestMessage = async function(message) {
    const msgUint8 = new TextEncoder().encode(message); // encode as (utf-8) Uint8Array
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgUint8); // hash the message
    const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""); // convert bytes to hex string
    return hashHex;
};
const getWsAdress = function (src) {
    const url = new URL(src);
    let address = "";
    if (url.protocol === "https:") {
        address += "wss://";
    } else {
        address += "ws://";
    }
    address += url.host;
    return address;
};

const API = class extends EventTarget {
    //properties
    isOnline = false;
    address = "";

    //connection and process
    ws = null;
    communicator = null;
    

    Communicator = class extends EventTarget {
        ws = null;
        processes = [];
        isServer = false;
        gcClear = 0;
        gcClearLimit = 10;

        FROM_MYSELF = 0;
        FROM_OTHER = 1;
        
        // methods: invoke, send, reply (for events),
        // events: invoke, send
        constructor(ws, isServer) {
            super();

            this.reset(ws, isServer);
        }
        reset(ws=this.ws, isServer=false) {
            this.FROM_MYSELF = (isServer ? 1 : 0);
            this.FROM_OTHER = (isServer ? 0 : 1);

            this.processes = [];
            this.ws = ws;
            this.ws.addEventListener("message", (event) =>  {
                console.log("Message from server: ", event.data);

                // handle syntax errors
                let data;
                try {
                    data = JSON.parse(event.data);
                    if ((data instanceof Array) === false || data.length < 2) {
                        throw new Error("Wrong format");
                    }
                } catch (error) {
                    console.log(error);
                    this.ws.send(JSON.stringify([this.FROM_OTHER, -1, 400]));
                    return;
                }

                // call recieve
                this.recieve(data);
            });
            
        };
        
        send(msg=[]) {
            //send data, fire and forget
            let data = [this.FROM_MYSELF, -1, ...msg];
            this.ws.send(JSON.stringify(data));
        };

        gc() {
            const lastEl = this.processes.length - 1;
            let i = lastEl;
            while(i >= 0 && this.processes[i] === null) {
                i--;
            }
            this.processes.splice(i+1, lastEl-i);
        };
        async invoke(msg=[], timeout=5000) {
            return new Promise((resolve, reject) => {
                // run garbage collector
                if (this.gcClear > this.gcClearLimit) {
                    this.gcClear = 0;
                    this.gc();
                }
                this.gcClear++;

                //get unique id from stack
                const id = this.processes.length;

                //start timeout
                const myTimeout = setTimeout(function() {
                    reject(new Error("Timeout (" + id + ")"));
                }, timeout);

                //set callback function in stack
                this.processes.push((data) => {
                    this.processes[id] = null;
                    clearTimeout(myTimeout);
                    resolve(data);
                });
                
                //send data
                let data = [this.FROM_MYSELF, id, ...msg];
                this.ws.send(JSON.stringify(data));
            });
        };
        recieve(data) {
            //process data
            if (data[0] === this.FROM_MYSELF) {
                //recieve response
                if (data[1] < this.processes.length && this.processes[data[1]] !== null) {
                    this.processes[data[1]](data.slice(2));
                }

            } else if (data[0] === this.FROM_OTHER) {
                //recieve request
                if (data[1] === -1) {
                    // no need reply for this
                    this.dispatchEvent(
                        new CustomEvent("send", {"detail": {
                            "data": data.slice(2)
                        }})
                    );
                } else {
                    // need reply for this with id
                    this.dispatchEvent(
                        new CustomEvent("invoke", {"detail": {
                            "id": data[1],
                            "data": data.slice(2)
                        }})
                    );
                }
                
            }
        };
        reply(id, msg=[]) {
            //send data
            let data = [this.FROM_OTHER, id, ...msg];
            this.ws.send(JSON.stringify(data));
        };
    };
    
    constructor(address) {
        super();

        this.address = address;
        this.connect();
    };
    connect() {
        this.ws = new WebSocket(this.address);
        this.communicator = new this.Communicator(this.ws, false);

        this.ws.addEventListener("open", () => {
            console.log("connected");
            this.isOnline = true;
            this.dispatchEvent(new Event("online"));
        });
        this.ws.addEventListener("error", () => {
            console.log("disconnected");
            this.isOnline = false;
            this.dispatchEvent(new CustomEvent("offline"));
        });
        this.ws.addEventListener("close", () => {
            console.log("closed");
            this.isOnline = false;
            this.dispatchEvent(new CustomEvent("offline"));
            setTimeout(this.connect.bind(this), 2000);
        });



        //listen non-respond api
        this.communicator.addEventListener("send", (event) => {

        });
        
        //listen respond api
        this.communicator.addEventListener("invoke", (event) => {
            console.log(event.detail);
            if (event.detail.data[0] === 1) {
                communicator.reply(event.detail.id, [0]);
            } else {
                communicator.reply(event.detail.id, [404]);
            }
        });
    };

    async ping() {
        return this.communicator.invoke([0]);
    };
    async login() {

    }
};


let api = null;
window.addEventListener("load", async function() {
    // Main (load libs and call the next step)
    const isDesktop = (typeof globalThis.require !== "undefined");
    let db = null;
    

    let ipcRenderer = null;
    let os = null;
    let fs = null;
    let path = null;
    let nutjs = null;
    let appAutoLaunch = null;
    const main = async function () {
        let address = "";

        //load libs
        if (isDesktop) {
            // Electron import
            let electron = require("electron");
            ipcRenderer = electron.ipcRenderer;
            ipcRenderer.on("api", function(event, ...arg) {
                if (arg[0] === "log") {
                    console.log(arg[1]);
                }
            });
            const pathApp = await ipcRenderer.invoke("api", "path-app");
            const pathExe = await ipcRenderer.invoke("api", "path-exe");
    
            // OS import
            os = require("node:os");
            // File system import
            fs = require("node:fs/promises");
            // Path import
            path = require("node:path");
            // Nut.js import
            nutjs = require(path.join(pathApp, "ui/libs/nutjs/nut.js"));
            // AutoLaunch import
            const AutoLaunch = require(path.join(pathApp, "ui/libs/auto-launch.js"));
            

            // Read server address
            let conf = await fs.readFile(path.join(pathApp, "conf.json"), {
                "encoding": "utf8"
            });
            conf = JSON.parse(conf);
            address = getWsAdress(conf["host"]);

            // Read app name and autolaunch
            let pack = await fs.readFile(path.join(pathApp, "package.json"), {
                "encoding": "utf8"
            });
            pack = JSON.parse(pack);
            appAutoLaunch = new AutoLaunch({
                "name": pack["name"],
                "path": pathExe,
            });
        } else {
            address = getWsAdress(location.href);
        }

        //create IDB
        await IdbHelper.TableSet("db", "settings");
        db = await IdbHelper.DatabaseGet("db");

        // handle websocket
        const loaderEl = document.getElementById("loading");
        const mainEl = document.getElementById("main");
        api = new API(address);
        api.addEventListener("online", function() {
            api.communicator.invoke([1]);
            loaderEl.classList.add("d-none");
            mainEl.classList.remove("d-none");
        });
        api.addEventListener("offline", function() {
            loaderEl.classList.remove("d-none");
            mainEl.classList.add("d-none");
        });

        
        
    };
    await main();


    // Home page
    let HomeAccount = null;
    {
        const page = document.getElementById("home");
        const btns = {
            "rooms": page.querySelector(".rooms"),
            "shared": page.querySelector(".shared"),
            "broadcast": page.querySelector(".broadcast"),
            "account": page.querySelector(".account")
        };
        const tabs = {
            "account": page.querySelector(".tab-content .account")
        };

        // Home page - MyLibrary


        // Home page - Shared


        // Home page - Broadcast


        // Home page - Account
        {
            // Download client
            if (isDesktop === false) {
                let req = null;
                const download = tabs["account"].querySelector(".download");
                const version = tabs["account"].querySelector(".version");
                download.addEventListener("click", function() {
                    if (req) {
                        return;
                    }
                    const filenames = {
                        "win": "electron-win32-x64.zip"
                    };
                    const filename = filenames[version.value];
                    req = new XMLHttpRequest();
                    req.open("GET", "/tmp/" + filename, true);
                    req.responseType = "blob";
                    req.addEventListener("progress", function(event) {
                        const percent = Math.floor(event.loaded / event.total * 100);
                        download.value = "Download client (" + percent + "%)";
                    });
                    req.addEventListener("load", async function() {
                        const fileBlob =  req.response;
                        if (fileBlob) {
                            console.log(fileBlob);
                            const zip = new JSZip();
                            await zip.loadAsync(fileBlob);
    
                            //edit conf.json
                            const confPath = "resources/app/conf.json";
                            let conf = await zip.file(confPath).async("string");
                            conf = JSON.parse(conf);
                            conf["host"] = location.protocol + "//" + location.host;
                            zip.file(confPath, JSON.stringify(conf));
    
                            //edit package.json
                            const packFile = "resources/app/package.json";
                            let pack = await zip.file(packFile).async("string");
                            pack = JSON.parse(pack);
                            pack["name"] = "desktop_streamer";
                            pack["name"] += await digestMessage(location.protocol + "//" + location.host);
                            zip.file(packFile, JSON.stringify(pack));
    
                            //download
                            const contentBlob = await zip.generateAsync({"type":"blob"});
                            const url = window.URL.createObjectURL(contentBlob);
    
                            const a = document.createElement("a");
                            document.body.appendChild(a);
                            a.style = "display: none";
                            a.href = url;
                            a.download = filename;
                            a.click();
                            window.URL.revokeObjectURL(url);
                            a.remove();
    
                            download.value = "Download client";
                            req = null;
                        }
                    });
                    req.send();
                });
            } else {
                const client = tabs["account"].querySelector(".client");
                client.classList.add("d-none");
            }

            // AutoLaunch and AutoLock
            let refreshButton = null;
            if (isDesktop) {
                const checker = tabs["account"].querySelector("#autolaunch");
                checker.addEventListener("click", function(event) {
                    if (event.target.checked) {
                        appAutoLaunch.enable();
                    } else {
                        appAutoLaunch.disable();
                    }
                });
                refreshButton = async function() {
                    checker.checked = await appAutoLaunch.isEnabled();
                };

                //autolocker
                const lockerDiv = tabs["account"].querySelector(".autolock");
                const locker = tabs["account"].querySelector("#autolock");
                if (os.platform() === "win32") {
                    locker.checked = (await IdbHelper.RowGet(db, "settings", [["autolock", false]]))[0];
                    ipcRenderer.send("api", "set-lock", locker.checked);
                    locker.addEventListener("click", async function(event) {
                        await IdbHelper.RowSet(db, "settings", [["autolock", event.target.checked]]);
                        ipcRenderer.send("api", "set-lock", event.target.checked);
                    });
                } else {
                    lockerDiv.classList.add("d-none");
                }
            } else {
                const program = tabs["account"].querySelector(".program");
                program.classList.add("d-none");
            }

            
            
            // Show page
            HomeAccount = async function() {
                page.classList.remove("d-none");
                btns["account"].classList.add("active");
                await refreshButton?.();
            };
        };
    }


    



    // Room
    let joinRoom = null;
    {

        // Room page - Users

        // Room page - View

        // Room page - Broadcast

        // Room page - Settings

    };
    













    await HomeAccount();

    

});