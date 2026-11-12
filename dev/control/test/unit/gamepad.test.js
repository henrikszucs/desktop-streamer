"use strict";

// The lifecycle tests plug in a real virtual gamepad, so they need the
// platform's driver (easy-control's own on Windows, uinput access on Linux, the CoreHID
// entitlement on macOS). Without it they are skipped, and create() is checked
// to say why instead.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Gamepad, distPath, platformDir } from "./helpers.js";

const BUTTON_COUNT = 17;
const AXIS_COUNT = 6;

// one probe decides which half of this file runs
let unavailableReason = "";
try {
    (await Gamepad.create()).destroy();
} catch (error) {
    unavailableReason = error.message;
}
const skipNoDriver = unavailableReason !== "" && ("no virtual gamepad: " + unavailableReason);

after(function() {
    for (const gamepad of Gamepad.list()) {
        gamepad.destroy();
    }
});

test("Gamepad.list starts empty", function() {
    assert.deepEqual(Gamepad.list(), []);
});

test("Gamepad.create returns a Promise", function() {
    const created = Gamepad.create();
    assert.ok(created instanceof Promise);
    // whatever it gives, nothing is left plugged in
    return created.then(function(gamepad) { gamepad.destroy(); }, function() {});
});

test("Gamepad.create rejects with an Error that says why", { "skip": !skipNoDriver && "a virtual gamepad can be made here" }, async function() {
    await assert.rejects(Gamepad.create(), function(error) {
        return error instanceof Error && error.message.length > 0 && typeof error.code === "string" && error.code.startsWith("EASYCONTROL_");
    });
    assert.deepEqual(Gamepad.list(), [], "a failed create leaves nothing in the list");
});

test("macOS: create() says which of its two failures it met", { "skip": (os.platform() !== "darwin" && "macOS only") || (!skipNoDriver && "a virtual gamepad can be made here") }, async function() {
    await assert.rejects(Gamepad.create(), function(error) {
        assert.equal(error.code, "EASYCONTROL_CREATE_FAILED");
        // before macOS 15 (Darwin 24) there is no HIDVirtualDevice to make
        if (Number(os.release().split(".")[0]) < 24) {
            assert.match(error.message, /macOS 15/);
        } else {
            assert.match(error.message, /macOS 15|activation did not finish/);
        }
        return true;
    });
});

test("a gamepad is only made by Gamepad.create", function() {
    assert.throws(function() { new Gamepad.create.Gamepad(); }, { "name": "TypeError", "message": /Gamepad\.create\(\)/ });
});

test("getDriverStatus reports the driver", function() {
    const status = Gamepad.getDriverStatus();
    assert.deepEqual(Object.keys(status).sort(), ["available", "isInstalled", "isOutdated", "isUpdateAvailable", "required", "version"]);
    assert.equal(typeof status["isInstalled"], "boolean");
    assert.equal(typeof status["isOutdated"], "boolean");
    assert.equal(typeof status["isUpdateAvailable"], "boolean");
    if (os.platform() === "win32") {
        assert.ok(Number.isInteger(status["required"]) && status["required"] >= 2);
        assert.ok(Number.isInteger(status["available"]) && status["available"] >= status["required"],
            "the driver beside the addon is one it works with");
        if (status["isInstalled"]) {
            assert.ok(Number.isInteger(status["version"]));
            assert.equal(status["isOutdated"], status["version"] < status["required"]);
            assert.equal(status["isUpdateAvailable"], status["version"] < status["available"]);
        } else {
            assert.equal(status["version"], null);
            assert.equal(status["isOutdated"], false);
            assert.equal(status["isUpdateAvailable"], false);
        }
    } else {
        // nothing to install elsewhere
        assert.equal(status["isInstalled"], true);
        assert.equal(status["isOutdated"], false);
        assert.equal(status["isUpdateAvailable"], false);
        assert.equal(status["available"], null);
    }
});

test("the driver files beside the addon are the version it was built with", { "skip": os.platform() !== "win32" && "the driver is Windows only" }, async function() {
    const file = JSON.parse(await fs.readFile(path.join(distPath, platformDir, "gamepad", "version.json"), "utf8"));
    const header = await fs.readFile(path.join(distPath, "..", "src", "native", "windows-gamepad", "common", "easycontrol_pad.h"), "utf8");
    const version = Number(header.match(/#define EASYCONTROL_PAD_VERSION (\d+)/)[1]);
    assert.equal(file["version"], version, "npm run build:gamepad after changing the driver");
    assert.equal(Gamepad.getDriverStatus()["available"], version);
});

test("installDriver rejects options that are no object, without starting the setup", async function() {
    await assert.rejects(Gamepad.installDriver("force"), TypeError);
});

test("without the driver, create rejects with EASYCONTROL_DRIVER_MISSING", {
    "skip": (os.platform() !== "win32" && "the driver is Windows only") ||
        (Gamepad.getDriverStatus()["isInstalled"] && "the driver is installed")
}, async function() {
    await assert.rejects(Gamepad.create(), { "code": "EASYCONTROL_DRIVER_MISSING", "message": /installDriver/ });
});

test("installDriver and uninstallDriver resolve at once where there is nothing to install", {
    // on Windows they ask for administrator rights, which a test must not
    "skip": os.platform() === "win32" && "would show a UAC prompt"
}, async function() {
    assert.equal(await Gamepad.installDriver(), undefined);
    assert.equal(await Gamepad.uninstallDriver(), undefined);
});

test("create plugs in an active gamepad that list reports", { "skip": skipNoDriver }, async function() {
    const gamepad = await Gamepad.create();
    try {
        assert.equal(gamepad.isActive(), true);
        assert.ok(gamepad instanceof Gamepad.create.Gamepad);
        assert.deepEqual(Gamepad.list(), [gamepad]);
    } finally {
        gamepad.destroy();
    }
});

test("every button and axis takes input", { "skip": skipNoDriver }, async function() {
    const gamepad = await Gamepad.create();
    try {
        for (let btn = 0; btn < BUTTON_COUNT; btn++) {
            gamepad.buttonDown(btn);
            gamepad.buttonUp(btn);
        }
        for (let axis = 0; axis < AXIS_COUNT; axis++) {
            for (const value of [-1, -0.5, 0, 0.5, 1]) {
                gamepad.setAxis(axis, value);
            }
            gamepad.setAxis(axis, axis >= 4 ? -1 : 0);   // triggers rest at -1
        }
    } finally {
        gamepad.destroy();
    }
});

test("buttons and axes reject bad indices and values", { "skip": skipNoDriver }, async function() {
    const gamepad = await Gamepad.create();
    try {
        for (const fn of ["buttonDown", "buttonUp"]) {
            assert.throws(function() { gamepad[fn](); }, TypeError);
            assert.throws(function() { gamepad[fn]("0"); }, TypeError);
            assert.throws(function() { gamepad[fn](-1); }, RangeError);
            assert.throws(function() { gamepad[fn](BUTTON_COUNT); }, { "name": "RangeError", "message": "Button index out of range (0-16)" });
            // not taken for 0, 1 or 1 (NaN, 1.5, 2**32 + 1 as Int32)
            for (const index of [NaN, 1.5, -0.5, Infinity]) {
                assert.throws(function() { gamepad[fn](index); }, { "name": "TypeError", "message": "Argument 1 must be an integer" }, String(index));
            }
            for (const index of [2 ** 32, 2 ** 32 + 1]) {
                assert.throws(function() { gamepad[fn](index); }, RangeError, String(index));
            }
        }
        for (const index of [NaN, 1.5, -0.5, Infinity]) {
            assert.throws(function() { gamepad.setAxis(index, 0); }, { "name": "TypeError", "message": "Argument 1 must be an integer" }, String(index));
        }
        for (const index of [2 ** 32, 2 ** 32 + 1]) {
            assert.throws(function() { gamepad.setAxis(index, 0); }, RangeError, String(index));
        }
        assert.throws(function() { gamepad.setAxis(); }, TypeError);
        assert.throws(function() { gamepad.setAxis(0); }, TypeError);
        assert.throws(function() { gamepad.setAxis(0, "1"); }, TypeError);
        assert.throws(function() { gamepad.setAxis(-1, 0); }, RangeError);
        assert.throws(function() { gamepad.setAxis(AXIS_COUNT, 0); }, { "name": "RangeError", "message": "Axis index out of range (0-5)" });
        assert.throws(function() { gamepad.setAxis(0, 1.01); }, RangeError);
        assert.throws(function() { gamepad.setAxis(0, -1.01); }, RangeError);
        assert.throws(function() { gamepad.setAxis(0, NaN); }, RangeError);
    } finally {
        gamepad.destroy();
    }
});

test("setState takes buttons and axes at once, a browser Gamepad's shape included", { "skip": skipNoDriver }, async function() {
    const gamepad = await Gamepad.create();
    try {
        gamepad.setState({ "buttons": [true, false, 1, 0, { "pressed": true, "value": 1 }, { "value": 0.2 }, 0.5, { "pressed": false, "value": 0 }],
            "axes": [0.5, -0.5, 0, 1, -1, 1] });
        gamepad.setState({ "axes": [0, 0, 0, 0, -1, -1] });
        // more entries than the pad has, holes and nulls are fine
        gamepad.setState({ "buttons": new Array(20).fill(false), "axes": [null, undefined, , 0] });
        gamepad.setState({});
    } finally {
        gamepad.destroy();
    }
});

test("setState checks everything before changing anything", { "skip": skipNoDriver }, async function() {
    const gamepad = await Gamepad.create();
    try {
        assert.throws(function() { gamepad.setState(); }, TypeError);
        assert.throws(function() { gamepad.setState(1); }, TypeError);
        assert.throws(function() { gamepad.setState({ "buttons": true }); }, { "name": "TypeError", "message": /buttons/ });
        assert.throws(function() { gamepad.setState({ "buttons": ["x"] }); }, { "name": "TypeError", "message": /buttons\[0\]/ });
        assert.throws(function() { gamepad.setState({ "buttons": [1.5] }); }, { "name": "RangeError", "message": /buttons\[0\]/ });
        assert.throws(function() { gamepad.setState({ "axes": [0, 2] }); }, { "name": "RangeError", "message": /axes\[1\]/ });
        assert.throws(function() { gamepad.setState({ "axes": ["0"] }); }, TypeError);
    } finally {
        gamepad.destroy();
    }
    assert.throws(function() { gamepad.setState({}); }, { "message": "Gamepad is not active" });
});

test("onRumble takes a listener or null", { "skip": skipNoDriver }, async function() {
    const gamepad = await Gamepad.create();
    try {
        assert.equal(gamepad.onRumble, null);
        const listener = function() {};
        gamepad.onRumble = listener;
        assert.equal(gamepad.onRumble, listener);
        gamepad.onRumble = function() {};
        gamepad.onRumble = null;
        assert.equal(gamepad.onRumble, null);
        assert.throws(function() { gamepad.onRumble = 1; }, TypeError);
        gamepad.onRumble = listener;
    } finally {
        gamepad.destroy();
    }
    assert.equal(gamepad.onRumble, null, "destroy drops the listener");
    assert.throws(function() { gamepad.onRumble = function() {}; }, { "message": "Gamepad is not active" });
    gamepad.onRumble = null;
});

test("several gamepads can be plugged in at once", { "skip": skipNoDriver }, async function() {
    const [first, second] = await Promise.all([Gamepad.create(), Gamepad.create()]);
    try {
        assert.notEqual(first, second);
        assert.equal(Gamepad.list().length, 2);
        assert.ok(Gamepad.list().includes(first) && Gamepad.list().includes(second));
        first.destroy();
        assert.deepEqual(Gamepad.list(), [second]);
        assert.equal(second.isActive(), true, "destroying one leaves the other active");
    } finally {
        first.destroy();
        second.destroy();
    }
});

test("destroy unplugs: inactive, out of the list, and its methods throw", { "skip": skipNoDriver }, async function() {
    const gamepad = await Gamepad.create();
    gamepad.destroy();
    assert.equal(gamepad.isActive(), false);
    assert.deepEqual(Gamepad.list(), []);
    assert.throws(function() { gamepad.buttonDown(0); }, { "message": "Gamepad is not active" });
    assert.throws(function() { gamepad.buttonUp(0); }, { "message": "Gamepad is not active" });
    assert.throws(function() { gamepad.setAxis(0, 0); }, { "message": "Gamepad is not active" });
    gamepad.destroy();   // a second destroy is harmless
    assert.equal(gamepad.isActive(), false);
});


//
// Linux rumble: ff-client.c uploads and plays force feedback effects on the
// pad's event device, as a game does, and onRumble reports them. It needs
// read-write access to that device, so it runs only where
// EASYCONTROL_RUMBLE_TEST=1 says it is set up - CI does
// (.github/workflows/build.yml). It is in this file because the test files
// run at the same time, and only this one's tests (which run one after
// another) make pads: the event device found by name is this test's own.
//
const hasCompiler = function() {
    try {
        execFileSync("cc", ["--version"], { "stdio": "ignore" });
        return true;
    } catch {
        return false;
    }
};

const skipNoRumbleTest = skipNoDriver ||
    (os.platform() !== "linux" && "Linux only") ||
    (process.env["EASYCONTROL_RUMBLE_TEST"] !== "1" && "needs the pad's event device; set EASYCONTROL_RUMBLE_TEST=1 to run it (CI does)") ||
    (!hasCompiler() && "no C compiler");

// the event device of the virtual pad, once udev has made it usable
const findEventDevice = async function() {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
        for (const entry of fsSync.readdirSync("/sys/class/input")) {
            if (!entry.startsWith("event")) {
                continue;
            }
            let name = "";
            try {
                name = fsSync.readFileSync(path.join("/sys/class/input", entry, "device", "name"), "utf8").trim();
            } catch {
                continue;
            }
            const device = path.join("/dev/input", entry);
            if (name === "Virtual Xbox 360 Controller") {
                try {
                    fsSync.accessSync(device, fsSync.constants.R_OK | fsSync.constants.W_OK);
                    return device;
                } catch {
                    // udev has not set its access yet
                }
            }
        }
        await new Promise(function(resolve) { setTimeout(resolve, 50); });
    }
    throw new Error("No usable event device of the virtual gamepad");
};

test("Linux: onRumble reports a game's rumble effects, their end by length and their stop", { "skip": skipNoRumbleTest }, async function() {
    const clientExe = path.join(os.tmpdir(), "easy-control-ff-client");
    execFileSync("cc", ["-o", clientExe, path.join(import.meta.dirname, "ff-client.c")]);
    assert.deepEqual(Gamepad.list(), [], "no other pad of this process");
    const gamepad = await Gamepad.create();
    try {
        const rumbles = [];
        gamepad.onRumble = function(rumble) {
            rumbles.push(rumble);
        };
        const device = await findEventDevice();
        // the client runs apart, as a game would: its uploads wait for the pad's answers
        await new Promise(function(resolve, reject) {
            execFile(clientExe, [device], function(error, stdout, stderr) {
                error ? reject(new Error(stderr || error.message)) : resolve();
            });
        });
        await new Promise(function(resolve) { setTimeout(resolve, 100); });
        const expected = [
            { "strong": 0xC000 / 65535, "weak": 0x4000 / 65535 },
            { "strong": 0, "weak": 0 },     // ended by its length
            { "strong": 1, "weak": 1 },
            { "strong": 0, "weak": 0 }      // stopped
        ];
        assert.equal(rumbles.length, expected.length, JSON.stringify(rumbles));
        rumbles.forEach(function(rumble, i) {
            assert.ok(Math.abs(rumble["strong"] - expected[i]["strong"]) < 1e-6 && Math.abs(rumble["weak"] - expected[i]["weak"]) < 1e-6,
                "rumble " + i + ": " + JSON.stringify(rumble) + ", expected " + JSON.stringify(expected[i]));
        });
    } finally {
        gamepad.destroy();
    }
});

