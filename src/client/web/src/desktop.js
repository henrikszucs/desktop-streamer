"use strict";

// the Electron side of the client: an empty object in a browser, the node and
// electron modules the renderer is allowed to reach under the desktop shell

// first-party dependencies
import { conf } from "./conf.js";
import { pickSystemName } from "./appname.js";

const desktop = {
    "isAvailable": false
};

// every name an auto-launch entry may still be under, the key the build before
// the list kept one in, and the product's own (CLIENT.md, "What the system is told")
const AUTO_LAUNCH_NAMES_KEY = "autoLaunchNames";
const OLD_AUTO_LAUNCH_NAME_KEY = "autoLaunchName";
const DEFAULT_AUTO_LAUNCH_NAME = "Desktop Streamer";

const readAutoLaunchNames = function() {
    try {
        const names = JSON.parse(localStorage.getItem(AUTO_LAUNCH_NAMES_KEY));
        if (Array.isArray(names) === true) {
            return names.filter((name) => typeof name === "string");
        }
        return [localStorage.getItem(OLD_AUTO_LAUNCH_NAME_KEY) ?? DEFAULT_AUTO_LAUNCH_NAME];
    } catch (error) {
        return [DEFAULT_AUTO_LAUNCH_NAME];
    }
};

const writeAutoLaunchNames = function(names) {
    try {
        localStorage.setItem(AUTO_LAUNCH_NAMES_KEY, JSON.stringify(names));
        localStorage.removeItem(OLD_AUTO_LAUNCH_NAME_KEY);
    } catch (error) {
        // not recorded, so the names are looked at again next time
    }
};

// an entry under another name moved to the current one, true once nothing is
// left under it - a failed move is logged and kept to try again
const moveEntry = async function(AutoLaunch, current, name, other, exePath) {
    const old = new AutoLaunch({"name": other, "path": exePath});
    try {
        if (await old.isEnabled() !== true) {
            return true;
        }
        if (other.toLowerCase() !== name.toLowerCase()) {
            // a login item on macOS is added again by every enable
            if (await current.isEnabled() !== true) {
                await current.enable();
            }
            await old.disable();
            return true;
        }
        // a case-only rename is one entry where the system ignores case, so
        // the old goes first - and comes back if the new cannot be made
        await old.disable();
        try {
            if (await current.isEnabled() !== true) {
                await current.enable();
            }
        } catch (error) {
            await old.enable();
            throw error;
        }
        return true;
    } catch (error) {
        console.error("Cannot move the auto launch entry \"" + other + "\" to \"" + name + "\":", error);
        return false;
    }
};

// the entry under the current name, answering for any left under another name
// until each is gone - moved at start, and again by any enable or disable
const openAutoLaunch = async function(AutoLaunch, name, exePath) {
    const current = new AutoLaunch({"name": name, "path": exePath});
    let others = readAutoLaunchNames().filter((other) => other !== name);
    writeAutoLaunchNames([name, ...others]);
    if (others.length === 0) {
        return current;
    }
    const moveOthers = async function() {
        const left = [];
        for (const other of others) {
            if (await moveEntry(AutoLaunch, current, name, other, exePath) === false) {
                left.push(other);
            }
        }
        others = left;
        writeAutoLaunchNames([name, ...others]);
    };
    await moveOthers();
    if (others.length === 0) {
        return current;
    }
    return {
        "enable": async function() {
            await moveOthers();
            if (await current.isEnabled() !== true) {
                await current.enable();
            }
        },
        // the others go whether or not there was an entry to disable here
        "disable": async function() {
            let failure = null;
            try {
                if (await current.isEnabled() === true) {
                    await current.disable();
                }
            } catch (error) {
                failure = error;
            }
            const left = [];
            for (const other of others) {
                try {
                    const old = new AutoLaunch({"name": other, "path": exePath});
                    if (await old.isEnabled() === true) {
                        await old.disable();
                    }
                } catch (error) {
                    console.error("Cannot disable the auto launch entry \"" + other + "\":", error);
                    left.push(other);
                }
            }
            others = left;
            writeAutoLaunchNames([name, ...others]);
            if (failure !== null) {
                throw failure;
            }
        },
        "isEnabled": async function() {
            if (await current.isEnabled() === true) {
                return true;
            }
            for (const other of others) {
                if (await new AutoLaunch({"name": other, "path": exePath}).isEnabled() === true) {
                    return true;
                }
            }
            return false;
        }
    };
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
    // else the product's own, which no dictionary slice failing can change
    desktop["autoLaunch"] = await openAutoLaunch(AutoLaunch,
        pickSystemName(conf["appearance"]?.["name"], DEFAULT_AUTO_LAUNCH_NAME), exePath);
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
