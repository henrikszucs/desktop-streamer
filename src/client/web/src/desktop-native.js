"use strict";

// the require() block of the Electron renderer, imported by core/desktop.js and
// only ever evaluated under the desktop shell

// fill the shared desktop object with everything the renderer may use
const load = async function(desktop) {
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

    return desktop;
};

export { load };
export default { load };
