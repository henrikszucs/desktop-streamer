"use strict";

window.addEventListener("load", async function() {
    const isDesktop = (typeof globalThis.require !== "undefined");
    let ipcRenderer = null;
    let fs = null;
    let path = null;
    let robotjs = null;
    if (isDesktop) {
        let electron = require("electron");
        ipcRenderer = electron.ipcRenderer;
        ipcRenderer.on("api", function(event, ...arg) {
            if (arg[0] === "log") {
                console.log(arg[1]);
            }
        });

        const pathApp = await ipcRenderer.invoke("api", "path-app");
        fs = require("node:fs/promises");
        path = require("node:path");
        robotjs = require(path.join(pathApp, "libs/robotjs/node_modules/@jitsi/robotjs"));
        console.log(robotjs);
    }

    // Loading page
    let LoadStart = null;
    {
        const page = document.getElementById("loading");
        
        LoadStart = async function() {
            //set display
            page.classList.remove("d-none");

            //get ws adress
            let address = "";
            if (window.location.protocol === "https:") {
                address += "wss://";
            } else {
                address += "ws://";
            }
            address += window.location.host;

            //connect
            let ws = new WebSocket(address);
            console.log(address);
            ws.binaryType = "string";
            ws.addEventListener("open", function() {
                console.log("connected");
            });
        };
        
    };
    LoadStart();




    // Home page - MyLibrary


    // Home page - Shared


    // Home page - Broadcast


    // Home page - Account



    // Room page - Users

    // Room page - View

    // Room page - Broadcast

    // Room page - Settings

















});