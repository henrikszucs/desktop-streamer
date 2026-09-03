"use strict";

// the Electron side of the client: an empty object in a browser, the node and
// electron modules the renderer is allowed to reach under the desktop shell

const desktop = {
    "isAvailable": false
};

// fill the object above under an Electron renderer - the modules it pulls in
// only exist there, so the require() block never runs in a browser
const initDesktop = async function() {
    if (typeof require === "undefined") {
        return desktop;
    }

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
    globalThis.require = undefined;

    return desktop;
};

export { desktop, initDesktop };
export default { desktop, initDesktop };
