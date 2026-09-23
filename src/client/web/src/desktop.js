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
const AUTO_LAUNCH_EXE_KEY = "autoLaunchExeName";
const DEFAULT_AUTO_LAUNCH_NAME = "Desktop Streamer";

// how long a call that never settles holds up the calls behind it, and the
// key a Windows entry is a value of
const AUTO_LAUNCH_QUEUE_TIMEOUT = 15000;
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

// the entry under a name - the library names every entry after the executable,
// so the name is put back, except for a macOS login item, which is named so
const createEntry = function(AutoLaunch, name, exePath) {
    const entry = new AutoLaunch({"name": name, "path": exePath});
    if (process.platform !== "darwin") {
        entry["opts"]["appName"] = name;
    }
    return entry;
};

// whether the entry under a name starts this executable - read around the
// library, which only answers whether there is one
const startsExe = async function(modules, name, exePath) {
    const { execFile, fs, path, os } = modules;
    if (process.platform === "win32") {
        const regPath = path.join(process.env["windir"] ?? "C:\\Windows", "system32", "reg.exe");
        const stdout = await new Promise(function(resolve) {
            execFile(regPath, ["query", RUN_KEY, "/v", name], {"windowsHide": true, "timeout": AUTO_LAUNCH_QUEUE_TIMEOUT}, function(error, stdout) {
                resolve(error === null ? String(stdout) : "");
            });
        });
        return stdout.toLowerCase().includes("\"" + exePath.toLowerCase() + "\"");
    }
    try {
        const text = await fs.readFile(path.join(os.homedir(), ".config/autostart", name + ".desktop"), "utf8");
        return text.split(/\r?\n/).some((line) => line === "Exec=" + exePath || line.startsWith("Exec=" + exePath + " "));
    } catch (error) {
        return false;
    }
};

// the name every build before the one above registered its entry under
const readExeName = function(AutoLaunch, exePath) {
    return new AutoLaunch({"name": "", "path": exePath})["opts"]["appName"];
};

// the list, and the executable's name the first time this executable is seen
const readAutoLaunchNames = function(exeName) {
    let names = [DEFAULT_AUTO_LAUNCH_NAME];
    try {
        const stored = JSON.parse(localStorage.getItem(AUTO_LAUNCH_NAMES_KEY));
        if (Array.isArray(stored) === true) {
            names = stored.filter((name) => typeof name === "string");
        } else {
            names = [localStorage.getItem(OLD_AUTO_LAUNCH_NAME_KEY) ?? DEFAULT_AUTO_LAUNCH_NAME];
        }
        if (localStorage.getItem(AUTO_LAUNCH_EXE_KEY) !== exeName) {
            names.push(exeName);
        }
    } catch (error) {
        names.push(exeName);
    }
    return [...new Set(names)].filter((name) => name !== "");
};

const writeAutoLaunchNames = function(names, exeName) {
    try {
        localStorage.setItem(AUTO_LAUNCH_NAMES_KEY, JSON.stringify(names));
        localStorage.setItem(AUTO_LAUNCH_EXE_KEY, exeName);
        localStorage.removeItem(OLD_AUTO_LAUNCH_NAME_KEY);
    } catch (error) {
        // not recorded, so the names are looked at again next time
    }
};

// an entry made with this path - enable rewrites a Run value or a file in
// place, but adds a macOS login item beside one already there
const enableEntry = async function(entry) {
    if (process.platform === "darwin" && await entry.isEnabled() === true) {
        return;
    }
    await entry.enable();
};

// an entry under another name moved to the current one, true once nothing of
// ours is left under it - a failed move is logged and kept to try again
const moveEntry = async function(AutoLaunch, current, name, other, exePath, isOurs) {
    try {
        const old = createEntry(AutoLaunch, other, exePath);
        if (await old.isEnabled() !== true || await isOurs(other) !== true) {
            return true;
        }
        if (other.toLowerCase() !== name.toLowerCase()) {
            await enableEntry(current);
            await old.disable();
            return true;
        }
        // a case-only rename is one entry where the system ignores case, so
        // the old goes first - and comes back if the new cannot be made
        await old.disable();
        try {
            await enableEntry(current);
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
// until each is gone - moved after boot, and again by every enable or disable
const openAutoLaunch = function(AutoLaunch, name, exePath, startsHere) {
    const current = createEntry(AutoLaunch, name, exePath);
    const exeName = readExeName(AutoLaunch, exePath);
    // a login item is always the bundle's name, so on macOS there is none to move
    const isMac = (process.platform === "darwin");
    let others = (isMac === true ? [] : readAutoLaunchNames(exeName).filter((other) => other !== name));
    const saveNames = function() {
        if (isMac === false) {
            writeAutoLaunchNames([name, ...others], exeName);
        }
    };
    saveNames();
    // the executable's name is as generic as "electron", so an entry under it
    // is ours only if it starts this executable
    const isOurs = async function(other) {
        return other !== exeName || await startsHere(other);
    };
    const moveOthers = async function() {
        if (others.length === 0) {
            return;
        }
        const left = [];
        for (const other of others) {
            if (await moveEntry(AutoLaunch, current, name, other, exePath, isOurs) === false) {
                left.push(other);
            }
        }
        others = left;
        saveNames();
    };
    // one call at a time, the move at start first, since each rewrites others -
    // one that never settles holds the rest only for AUTO_LAUNCH_QUEUE_TIMEOUT
    let queue = Promise.resolve();
    const run = function(task) {
        const result = queue.then(task);
        queue = Promise.race([result.catch(function() {}), new Promise(function(resolve) {
            setTimeout(resolve, AUTO_LAUNCH_QUEUE_TIMEOUT);
        })]);
        return result;
    };
    run(moveOthers).catch(function(error) {
        console.error("Cannot move the auto launch entries:", error);
    });
    return {
        "enable": () => run(async function() {
            await moveOthers();
            await enableEntry(current);
        }),
        // the others go whether or not there was an entry to disable here
        "disable": () => run(async function() {
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
                    const old = createEntry(AutoLaunch, other, exePath);
                    if (await old.isEnabled() === true && await isOurs(other) === true) {
                        await old.disable();
                    }
                } catch (error) {
                    console.error("Cannot disable the auto launch entry \"" + other + "\":", error);
                    left.push(other);
                }
            }
            others = left;
            saveNames();
            if (failure !== null) {
                throw failure;
            }
        }),
        "isEnabled": () => run(async function() {
            if (await current.isEnabled() === true) {
                return true;
            }
            for (const other of others) {
                if (await createEntry(AutoLaunch, other, exePath).isEnabled() === true && await isOurs(other) === true) {
                    return true;
                }
            }
            return false;
        })
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
    const fs = require("node:fs/promises");
    const { spawn, execFile } = require("node:child_process");

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
    desktop["autoLaunch"] = openAutoLaunch(AutoLaunch,
        pickSystemName(conf["appearance"]?.["name"], DEFAULT_AUTO_LAUNCH_NAME), exePath, function(name) {
            return startsExe({"execFile": execFile, "fs": fs, "path": path, "os": os}, name, exePath);
        });
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
