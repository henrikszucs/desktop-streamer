"use strict";

// Loads the native addon of this platform and CPU. Where there is none, or it
// does not load, importing still works: Platform.isSupported is false and
// every other function throws (or, for the ones returning a Promise, rejects
// with) an Error with code EASYCONTROL_UNSUPPORTED_PLATFORM saying why.

const os = require("node:os");
const { isMainThread } = require("node:worker_threads");

// the builds in dist/, made by CI (.github/workflows/build.yml)
const SUPPORTED_TARGETS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"];

// every function of each object; the stand-ins are made from it, and
// easy-control.d.ts declares the same
const API = {
    "Mouse": ["getX", "getY", "getPosition", "getIcon", "getIconId", "setX", "setY", "setPosition",
        "moveBy", "moveByX", "moveByY", "buttonDown", "buttonUp", "releaseAll", "scrollDown", "scrollUp", "scroll"],
    "Keyboard": ["keyDown", "keyUp", "releaseAll", "isKeySupported", "type", "getLockState",
        "getLayout", "setLayout", "GetLayout", "SetLayout"],
    "Gamepad": ["list", "create", "getDriverStatus", "installDriver", "uninstallDriver"],
    "Screen": ["list"]
};
const ASYNC_FUNCTIONS = ["Gamepad.create", "Gamepad.installDriver", "Gamepad.uninstallDriver"];

const target = os.platform() + "-" + os.arch();
let addon = null;
let loadError = null;
if (!SUPPORTED_TARGETS.includes(target)) {
    loadError = "easy-control has no build for " + target + "; it supports " + SUPPORTED_TARGETS.join(", ");
} else {
    try {
        addon = require("./" + target + "/easy-control.node");
    } catch (error) {
        loadError = "easy-control could not load its " + target + " build: " + error.message;
    }
    // a build from before this loader lacks what it relies on
    if (addon !== null && (typeof addon.Platform !== "object" || typeof addon.Platform.getInputBlock !== "function")) {
        addon = null;
        loadError = "easy-control's " + target + " build is older than its loader; it needs rebuilding (npm run build)";
    }
}

const unsupportedError = function() {
    const error = new Error(loadError);
    error.code = "EASYCONTROL_UNSUPPORTED_PLATFORM";
    return error;
};

// the addon's object, or a stand-in whose functions say why there is none;
// neither is frozen, so an app's test doubles can replace their functions
const namespace = function(name) {
    if (addon !== null) {
        return addon[name];
    }
    const stub = {};
    for (const method of API[name]) {
        stub[method] = ASYNC_FUNCTIONS.includes(name + "." + method)
            ? function() { return Promise.reject(unsupportedError()); }
            : function() { throw unsupportedError(); };
    }
    return stub;
};

const Mouse = namespace("Mouse");
const Keyboard = namespace("Keyboard");
const Gamepad = namespace("Gamepad");
const Screen = namespace("Screen");

const Platform = Object.freeze({
    "target": target,
    "supportedTargets": Object.freeze(SUPPORTED_TARGETS.slice()),
    "isSupported": addon !== null,
    "loadError": loadError,
    "hasInputAccess": function() {
        return addon !== null && addon.Platform.hasInputAccess();
    },
    "getInputBlock": function() {
        if (addon === null) {
            throw unsupportedError();
        }
        return addon.Platform.getInputBlock();
    },
    "requestInputAccess": function() {
        return addon !== null ? addon.Platform.requestInputAccess() : Promise.resolve(false);
    }
});

// Keys and buttons held down when the process ends are released, so a closing
// app leaves none pressed. On SIGINT and SIGTERM the default (ending the
// process) still happens, unless the app listens for them itself.
// Only the main thread does it: what is held is kept for the whole process,
// so a worker ending must not release what the other threads hold.
// The functions are taken now: the namespaces are the app's objects too, and
// what an app puts in Keyboard.releaseAll is not what is to run at exit.
if (addon !== null && isMainThread) {
    const releaseKeys = addon.Keyboard.releaseAll;
    const releaseButtons = addon.Mouse.releaseAll;
    const releaseAll = function() {
        // each on its own: keys that cannot be released keep no button held
        for (const release of [releaseKeys, releaseButtons]) {
            try {
                release();
            } catch {
                // ending anyway
            }
        }
    };
    process.on("exit", releaseAll);
    const onSignal = function(signal) {
        releaseAll();
        if (process.listenerCount(signal) === 0) {
            process.kill(process.pid, signal);
        }
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
}

module.exports = { Mouse, Keyboard, Gamepad, Screen, Platform };
