"use strict";

const { ipcRenderer } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

window.addEventListener("load", async function() {
    const pathApp = await ipcRenderer.invoke("api", "path-app");
    const pathExe = await ipcRenderer.invoke("api", "path-exe");
    const AutoLaunch = require(path.join(pathApp, "ui/libs/auto-launch.js"));

    await IdbHelper.TableSet("db", "table");
    const db = await IdbHelper.DatabaseGet("db");


    // Check configuration
    let confURL = undefined;
    let confIsAutoConnect = undefined;
    let confIsAutoLaunch = undefined;
    try {
        const contents = await fs.readFile(pathApp + "/conf.json", {
            "encoding": "utf8"
        });
        const confIn = JSON.parse(contents);
        if (typeof confIn !== "object") {
            throw new Error("Invalid JSON format!");
        }
        if (typeof confIn["url"] === "string") {
            confURL = confIn["url"];
        }
        if (typeof confIn["isAutoConnect"] === "boolean") {
            confIsAutoConnect = confIn["isAutoConnect"];
        }
        if (typeof confIn["isAutoLaunch"] === "boolean") {
            confIsAutoLaunch = confIn["isAutoLaunch"];
        }
    } catch (error) {
        console.log(error);
    }

    



    // URL input
    const urlEl = document.getElementById("url");
    if (typeof confURL === "undefined") {
        let url = await IdbHelper.RowGet(db, "table", [["url", ""]]);
        url = url[0];
        urlEl.value = url;
    } else {
        urlEl.disabled = true;
        urlEl.value = confURL;
    }
    urlEl.addEventListener("change", async function(event) {
        await IdbHelper.RowSet(db, "table", [["url", event.target.value]]);
    });


    // Auto connect
    const autoConnectEl = document.getElementById("auto-connect");
    if (typeof confIsAutoConnect === "undefined") {
        let isAutoConnect = await IdbHelper.RowGet(db, "table", [["isAutoConnect", false]]);
        isAutoConnect = isAutoConnect[0];
        autoConnectEl.checked = isAutoConnect;
    } else {
        autoConnectEl.disabled = true;
        autoConnectEl.checked = confIsAutoConnect;
    }
    autoConnectEl.addEventListener("change", async function(event) {
        console.log(event)
        await IdbHelper.RowSet(db, "table", [["isAutoConnect", event.target.checked]]);
    });


    // Auto launch
    const autoLaunchEl = document.getElementById("auto-launch");
    if (typeof confIsAutoLaunch === "undefined") {
        let isAutoLaunch = await IdbHelper.RowGet(db, "table", [["isAutoLaunch", false]]);
        isAutoLaunch = isAutoLaunch[0];
        autoLaunchEl.checked = isAutoLaunch;
    } else {
        autoLaunchEl.disabled = true;
        autoLaunchEl.checked = confIsAutoLaunch;
    }
    autoLaunchEl.addEventListener("change", async function(event) {
        await IdbHelper.RowSet(db, "table", [["isAutoLaunch", event.target.checked]]);
    });


    // Send button
    const connectEl = document.getElementById("connect");
    connectEl.addEventListener("click", async function() {
        ipcRenderer.send("api", "change-tab-url", urlEl.value);
    });



    //auto launch
    const launch = new AutoLaunch({
        "name": "Remote Desktop",
        "path": pathExe,
        "isHidden": true
    });
    if (autoLaunchEl.checked === true) {
        launch.enable();
    } else {
        launch.disable();
    }


    //quick start
    if (typeof confURL !== "undefined" && typeof confIsAutoConnect !== "undefined" && typeof confIsAutoLaunch !== "undefined") {
        if (confIsAutoConnect === true) {
            ipcRenderer.send("api", "change-tab-url", confURL);
        }
    }


    //auto connect
    if (autoConnectEl.checked === true) {
        let countStart = 0;
        let countEnd = 4;
        const counting = function() {
            if (countStart < countEnd) {
                countStart++;
                connectEl.value = "Connect " + String(countEnd - countStart);
            } else {
                ipcRenderer.send("api", "change-tab-url", urlEl.value);
            }
        }
        
        if (autoConnectEl.checked === true) {
            counting();
            let countingId = setInterval(counting, 1000);
            
            autoConnectEl.addEventListener("change", function(event) {
                if (event.target.checked === false) {
                    clearInterval(countingId);
                    connectEl.value = "Connect";
                }
            });
        } else {
            connectEl.value = "Connect";
        }
    }

    
});

//debug
ipcRenderer.on("api", function(event, ...arg) {
    if (arg[0] === "log") {
        console.log(arg[1]);
    }
});