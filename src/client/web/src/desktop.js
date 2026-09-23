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

// the name the auto-launch entry was last registered under, and the one it had
// before the name could be configured (see CLIENT.md, "What the system is told")
const AUTO_LAUNCH_NAME_KEY = "autoLaunchName";
const LEGACY_AUTO_LAUNCH_NAME = "Desktop Streamer";

const readAutoLaunchName = function() {
    try {
        return localStorage.getItem(AUTO_LAUNCH_NAME_KEY) ?? LEGACY_AUTO_LAUNCH_NAME;
    } catch (error) {
        return LEGACY_AUTO_LAUNCH_NAME;
    }
};

const writeAutoLaunchName = function(name) {
    try {
        localStorage.setItem(AUTO_LAUNCH_NAME_KEY, name);
    } catch (error) {
        // not recorded, so the move is looked at again next time
    }
};

// a name that differs only in case is one entry where the system ignores case
// (the Run key, a macOS file name) and two where it does not (Linux), so the
// old one goes before the new one is made - the other order would remove both
const moveCaseOnly = async function(AutoLaunch, previous, name, exePath) {
    const current = new AutoLaunch({"name": name, "path": exePath});
    try {
        const old = new AutoLaunch({"name": previous, "path": exePath});
        if (await old.isEnabled() === true) {
            await old.disable();
            await current.enable();
        }
        writeAutoLaunchName(name);
    } catch (error) {
        console.error("Cannot move the auto launch entry to \"" + name + "\":", error);
    }
    return current;
};

// the entry under the current name, answering for one left under the previous
// name until it is gone - moved at start, and again by any enable or disable
// when that failed; once it is gone, the entry alone
const openAutoLaunch = async function(AutoLaunch, name, exePath) {
    const current = new AutoLaunch({"name": name, "path": exePath});
    const previous = readAutoLaunchName();
    if (previous === name) {
        return current;
    }
    if (previous.toLowerCase() === name.toLowerCase()) {
        return await moveCaseOnly(AutoLaunch, previous, name, exePath);
    }
    const old = new AutoLaunch({"name": previous, "path": exePath});
    let isMoved = false;
    // the old entry off, and the name recorded once nothing is left under it
    const dropOld = async function() {
        if (isMoved === true) {
            return;
        }
        if (await old.isEnabled() === true) {
            await old.disable();
        }
        writeAutoLaunchName(name);
        isMoved = true;
    };
    const autoLaunch = {
        "enable": async function() {
            await current.enable();
            await dropOld();
        },
        // the old entry goes whether or not there was one to disable here
        "disable": async function() {
            try {
                if (await current.isEnabled() === true) {
                    await current.disable();
                }
            } finally {
                await dropOld();
            }
        },
        "isEnabled": async function() {
            return await current.isEnabled() === true || (isMoved === false && await old.isEnabled() === true);
        }
    };
    try {
        if (await old.isEnabled() === true) {
            await autoLaunch.enable();
        } else {
            writeAutoLaunchName(name);
            isMoved = true;
        }
    } catch (error) {
        console.error("Cannot move the auto launch entry to \"" + name + "\":", error);
    }
    return (isMoved === true ? current : autoLaunch);
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
    // the system is told the name in English, or the first one configured -
    // and the legacy name where the dictionary slice holding it did not load
    desktop["autoLaunch"] = await openAutoLaunch(AutoLaunch, pickSystemName(conf["appearance"]?.["name"],
        pickSystemName({"en": localization.get("main.name", "en")}, LEGACY_AUTO_LAUNCH_NAME)), exePath);
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
