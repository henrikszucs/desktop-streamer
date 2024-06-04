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

window.addEventListener("load", async function() {
    // Main (load libs and call the next step)
    const isDesktop = (typeof globalThis.require !== "undefined");
    let db = null;
    let address = "";
    let ws = null;

    let ipcRenderer = null;
    let os = null;
    let fs = null;
    let path = null;
    let nutjs = null;
    let appAutoLaunch = null;
    const main = async function () {
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
        const loader = document.getElementById("loading");
        const createConnection = function() {
            ws = new WebSocket(address);
            ws.addEventListener("open", function() {
                console.log("connected");
                loader.classList.add("d-none");
                //ws.send("ping");
            });
            ws.addEventListener("error", function() {
                loader.classList.remove("d-none");
                createConnection();
            });
            ws.addEventListener("close", function() {
                loader.classList.remove("d-none");
                createConnection();
            });

            //handle API
            ws.addEventListener("message", function(event) {
                console.log("Message from server ", event.data);
            });
            return ws;
        };
        ws = createConnection();
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
            //download
            const client = tabs["account"].querySelector(".client");
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
                client.classList.add("d-none");
            }

            // Autolaunch and lock autolock
            const program = tabs["account"].querySelector(".program");
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
                program.classList.add("d-none");
            }
            

            HomeAccount = async function() {
                page.classList.remove("d-none");
                btns["account"].classList.add("active");
                await refreshButton?.();
                return;
                //get ws address
                let address = "";
                if (window.location.protocol === "https:") {
                    address += "wss://";
                } else {
                    address += "ws://";
                }
                address += window.location.host;

                
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