"use strict";

// the Electron side of the client: an empty object in a browser, the node and
// electron modules the renderer is allowed to reach under the desktop shell

// first-party dependencies
import { conf } from "./conf.js";
import localization from "./localization.js";
import { pickSystemName } from "./appname.js";

const desktop = {
    "isAvailable": false
};

// what the auto-launch entry was last registered under, and what it was called
// before the name could be configured. The entry is found by its name, so one
// under an earlier name would go on starting the application beside the new
// one, and the setting would read it as off.
const AUTO_LAUNCH_NAME_KEY = "autoLaunchName";
const LEGACY_AUTO_LAUNCH_NAME = "Desktop Streamer";

// the auto-launch entry under the current name, an enabled one under an earlier
// name moved across first - the new one enabled before the old one goes, so a
// failure leaves the old entry standing and the move is tried at the next start
const openAutoLaunch = async function(AutoLaunch, name, exePath) {
    const current = new AutoLaunch({"name": name, "path": exePath});
    let previous = LEGACY_AUTO_LAUNCH_NAME;
    try {
        previous = localStorage.getItem(AUTO_LAUNCH_NAME_KEY) ?? LEGACY_AUTO_LAUNCH_NAME;
    } catch (error) {
        previous = LEGACY_AUTO_LAUNCH_NAME;
    }
    if (previous !== name) {
        try {
            const old = new AutoLaunch({"name": previous, "path": exePath});
            if (await old.isEnabled() === true) {
                await current.enable();
                await old.disable();
            }
        } catch (error) {
            console.error("Cannot move the auto launch entry to \"" + name + "\":", error);
            return current;
        }
    }
    try {
        localStorage.setItem(AUTO_LAUNCH_NAME_KEY, name);
    } catch (error) {
        // not recorded, so the move is looked at again next time
    }
    return current;
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
    const { ipcRenderer, clipboard } = require("electron");
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
    // the system clipboard, read and written straight from the renderer: it is
    // what a shared clipboard is made of on either side of a room (see
    // src/room/clipboard.js), and a browser peer has navigator.clipboard in
    // its place
    desktop["clipboard"] = clipboard;
    desktop["appPath"] = appPath;
    // the system is told the name in English, or the first one configured
    desktop["autoLaunch"] = await openAutoLaunch(AutoLaunch,
        pickSystemName(conf["appearance"]?.["name"], localization.get("main.name", "en")), exePath);
    desktop["Control"] = Control;
    desktop["ffmpegPath"] = path.join(appPath, "libs/ffmpeg");
    desktop["FFmpegVideoEncoder"] = FFmpegEncoder["FFmpegVideoEncoder"];
    desktop["FFmpegAudioEncoder"] = FFmpegEncoder["FFmpegAudioEncoder"];
    // a bare ffmpeg with its stdout handed over: the desktop host's sound
    // fallback, raw PCM that src/room/stream.js encodes itself
    desktop["FFmpegProcess"] = FFmpegEncoder["FFmpegProcess"];

    // disable require to prevent security issues
    globalThis.require = undefined;

    return desktop;
};

export { desktop, initDesktop };
export default { desktop, initDesktop };
