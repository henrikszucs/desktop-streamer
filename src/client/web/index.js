"use strict";

// import dependencies
import IDB from "./libs/idb/idb.js";
import Communicator from "./libs/communicator/communicator.js";
import {BrowserAudioEncoder} from "./libs/ffmpeg-chunkifier/encoder-browser.js";
import {Decoder, Player} from "./libs/ffmpeg-chunkifier/decoder.js";
import localization from "./localization.js";


// Configuration
// Task to load enviroment and essential data and desktop libs for the application.
const Enviroment = class extends EventTarget {
    constructor() {
        super();

        this.DATABBASE = "desktop_streamer";
        this.CONF_TABLE = "configuration";
        // start DOM wait
        this.waitDOM = new Promise(function (resolve) {
            window.addEventListener("load", () => {
                resolve();
            }, { "once": true });
        });
        this.configuration = {};    // local configuration values
        this.desktop = {};          // desktop specific APIs and libs
        this.server = {};           // server configuration from conf.json
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
        this.configuration["exitShortcuts"] = JSON.parse(this.configuration["exitShortcuts"]);

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
};
const enviroment = new Enviroment();



const Server = class extends EventTarget {
    constructor() {
        super();
    };
};
const server = new Server();


const main = async function() {
    await enviroment.load();

    
    server.load();
};
main();