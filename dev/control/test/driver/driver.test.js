"use strict";

// The Windows gamepad driver's install and uninstall, for real:
//
//     npm run test:driver
//
// Each install and uninstall asks for administrator rights, so this shows
// UAC prompts to approve (two, or three when the driver was not installed
// before). It leaves the driver as it found it. Not part of `npm test`.
//
// The version checks change the installed version in the registry, which
// takes administrator rights too: they run when the test itself does (CI),
// and are skipped otherwise.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Gamepad, distPath, platformDir } from "../unit/helpers.js";

const isWindows = os.platform() === "win32";
const skip = !isWindows && "the driver is Windows only";

const SERVICE_NAME = "EasyControlGamepad";
const INSTALL_DIR = path.join(process.env["ProgramFiles"] || "C:\\Program Files", "easy-control", "gamepad");
const SETUP_SCRIPT = path.join(distPath, platformDir, "gamepad", "easy-control-gamepad-setup.ps1");

// a UAC prompt waits for a person
const UAC_TIMEOUT = 5 * 60 * 1000;

const powershell = function(script) {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { "encoding": "utf8" }).trim();
};

// what the setup script finds: packages in the driver store, certificates
const setupStatus = function() {
    return JSON.parse(execFileSync("powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SETUP_SCRIPT, "status"], { "encoding": "utf8" }));
};

const serviceExists = function(name) {
    return powershell("[bool](Get-Service -Name '" + name + "' -ErrorAction SilentlyContinue)") === "True";
};

// every device node of ours Windows knows, plugged in or remembered
const deviceNodes = function() {
    const ids = powershell("Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'SWD\\EASYCONTROL*' -or $_.InstanceId -like 'HID\\EASYCONTROL*' } | " +
        "ForEach-Object { $_.InstanceId }");
    return ids ? ids.split(/\r?\n/) : [];
};

const assertInstalled = function() {
    const status = Gamepad.getDriverStatus();
    assert.equal(status["isInstalled"], true);
    assert.equal(status["version"], status["available"], "the version beside the addon is installed");
    assert.equal(status["isOutdated"], false);
    assert.equal(status["isUpdateAvailable"], false);
    assert.equal(serviceExists(SERVICE_NAME), true, "the service is registered");
    const setup = setupStatus();
    assert.equal(setup["driverPackages"].length, 2, "the HID and the XUSB driver packages: " + setup["driverPackages"]);
    // the certificate is trusted, and its private key is gone with it from the personal store
    const stores = setup["certificates"].map(function(entry) {
        return entry.split(":")[0];
    }).sort();
    assert.deepEqual(stores, ["Root", "TrustedPublisher"], "one certificate, trusted: " + setup["certificates"]);
    // both packages in the driver store are this version: DriverVer ends with it
    assert.equal(setup["packageVersion"], status["available"]);
    for (const driverVer of setup["driverVersions"]) {
        assert.match(driverVer, new RegExp("\\." + status["available"] + "$"), "DriverVer " + driverVer);
    }
    for (const file of ["easy-control-gamepad-service.exe", "driver\\easycontrol_gamepad.dll"]) {
        assert.ok(fs.existsSync(path.join(INSTALL_DIR, file)), file + " in Program Files");
    }
};

let wasInstalled = false;

before(async function() {
    if (!isWindows) {
        return;
    }
    wasInstalled = Gamepad.getDriverStatus()["isInstalled"];
    if (!wasInstalled) {
        // something to remove first
        await Gamepad.installDriver();
    }
});

after(async function() {
    // as it was found
    if (isWindows && !wasInstalled && Gamepad.getDriverStatus()["isInstalled"]) {
        await Gamepad.uninstallDriver();
    }
});

test("uninstallDriver removes the driver, its service, certificate, files and devices", { skip, "timeout": UAC_TIMEOUT }, async function() {
    // a pad plugged in while it goes
    const gamepad = await Gamepad.create();
    assert.equal(gamepad.isActive(), true);
    gamepad.destroy();

    assert.equal(await Gamepad.uninstallDriver(), undefined);

    const status = Gamepad.getDriverStatus();
    assert.equal(status["isInstalled"], false);
    assert.equal(status["version"], null);
    assert.equal(status["isOutdated"], false);
    assert.equal(serviceExists(SERVICE_NAME), false, "the service is gone");
    const setup = setupStatus();
    assert.deepEqual(setup["driverPackages"], [], "no driver package left in the driver store");
    assert.deepEqual(setup["certificates"], [], "no certificate left in any store");
    assert.equal(fs.existsSync(INSTALL_DIR), false, "Program Files folder is gone");
    assert.deepEqual(deviceNodes(), [], "Windows remembers no device of ours");
    for (const log of ["gamepad-service.log", "gamepad-service.log.old"]) {
        assert.equal(fs.existsSync(path.join(path.dirname(LOG_FILE), log)), false, log + " is removed");
    }
    // Windows' own filter driver stays
    // (Windows Server editions have none to leave)
    if (fs.existsSync(path.join(process.env["windir"] || "C:\\Windows", "System32", "drivers", "xinputhid.sys"))) {
        assert.equal(serviceExists("xinputhid"), true, "xinputhid is left in place");
    }

    await assert.rejects(Gamepad.create(), { "code": "EASYCONTROL_DRIVER_MISSING" });
});

test("installDriver puts it back, and a gamepad works again", { skip, "timeout": UAC_TIMEOUT }, async function() {
    assert.equal(await Gamepad.installDriver(), undefined);
    assertInstalled();

    const gamepad = await Gamepad.create();
    try {
        assert.equal(gamepad.isActive(), true);
        gamepad.buttonDown(0);
        gamepad.setAxis(0, 0.5);
    } finally {
        gamepad.destroy();
    }
});

const LOG_FILE = path.join(process.env["ProgramData"] || "C:\ProgramData", "easy-control", "gamepad-service.log");

const serviceStatus = function() {
    return powershell("(Get-Service -Name '" + SERVICE_NAME + "').Status.ToString()");
};

test("the service logs the pads it plugs in and out", { skip, "timeout": UAC_TIMEOUT }, async function() {
    const gamepad = await Gamepad.create();
    gamepad.destroy();
    // the service writes the unplug once it sees the connection close
    let log = "";
    for (let i = 0; i < 50 && !/unplugged/.test(log); i++) {
        await new Promise(function(resolve) { setTimeout(resolve, 100); });
        log = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf8") : "";
    }
    assert.match(log, new RegExp("started, version " + Gamepad.getDriverStatus()["available"] + "\\b"), "the running service is the installed version");
    assert.match(log, /pad \d plugged in: SWD\\EasyControl\\Pad\d, SWD\\EasyControl_IG_00\\Pad\d/i);
    assert.match(log, /pad \d unplugged/);
});

test("the service stops itself when idle and starts again on demand", { skip, "timeout": 3 * 60 * 1000 }, async function() {
    assert.deepEqual(Gamepad.list(), [], "no pad of this process plugged in");
    // it stops after 60 s without a client or a pad; checked every 5 s
    const end = Date.now() + 90 * 1000;
    while (serviceStatus() !== "Stopped" && Date.now() < end) {
        await new Promise(function(resolve) { setTimeout(resolve, 2000); });
    }
    assert.equal(serviceStatus(), "Stopped", "the idle service stopped");

    const gamepad = await Gamepad.create();
    try {
        assert.equal(gamepad.isActive(), true);
        assert.equal(serviceStatus(), "Running", "create() started it again");
    } finally {
        gamepad.destroy();
    }
});


//
// versions
//
const REGISTRY_KEY = "HKLM:\\SOFTWARE\\easy-control\\Gamepad";
const SETUP_LOG = path.join(process.env["ProgramData"] || "C:\\ProgramData", "easy-control", "gamepad-setup.log");

const isAdministrator = isWindows && powershell("([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())" +
    ".IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)") === "True";
const skipNotAdmin = skip || (!isAdministrator && "changing the installed version in the registry needs administrator rights");

const setRegistryVersion = function(version) {
    powershell("Set-ItemProperty '" + REGISTRY_KEY + "' -Name Version -Value " + version + " -Type DWord");
};

// runs a check with the registry saying another version is installed, and
// puts the real one back
const withRegistryVersion = async function(version, check) {
    const real = Gamepad.getDriverStatus()["version"];
    setRegistryVersion(version);
    try {
        await check(Gamepad.getDriverStatus());
    } finally {
        setRegistryVersion(real);
    }
};

// stopping the service and changing its start type take administrator rights
test("create() right after the service was told to stop starts it again", { "skip": skipNotAdmin, "timeout": 5 * 60 * 1000 }, async function() {
    // The idle stop reports RUNNING until it has stopped, sc stop reports
    // STOP_PENDING: both leave the pipe gone while StartService answers that
    // it runs. sc returns once the service reports stop-pending.
    for (let i = 0; i < 10; i++) {
        (await Gamepad.create()).destroy();
        try {
            execFileSync("sc.exe", ["stop", SERVICE_NAME], { "stdio": "ignore" });
        } catch {
            // still starting, or stopped already: the next round tries again
        }
        const start = Date.now();
        const gamepad = await Gamepad.create();
        gamepad.destroy();
        assert.ok(Date.now() - start < 8000, "round " + i + ": create() took " + (Date.now() - start) + " ms");
    }
});

const serviceStartType = function() {
    return powershell("(Get-Service -Name '" + SERVICE_NAME + "').StartType.ToString()");
};
let savedStartType = null;
const restoreStartType = function() {
    if (savedStartType !== null) {
        powershell("Set-Service -Name '" + SERVICE_NAME + "' -StartupType " + savedStartType);
        savedStartType = null;
    }
};
after(restoreStartType);

// (the PowerShell calls around it take long on a slow runner: CI's Windows ARM)
test("create() fails fast when the service cannot be started", { "skip": skipNotAdmin, "timeout": 5 * 60 * 1000 }, async function() {
    savedStartType = serviceStartType();
    try {
        powershell("Stop-Service -Name '" + SERVICE_NAME + "' -Force; Set-Service -Name '" + SERVICE_NAME + "' -StartupType Disabled");
        const start = Date.now();
        await assert.rejects(Gamepad.create(), { "code": "EASYCONTROL_SERVICE_FAILED", "message": /Starting the gamepad service failed/ });
        assert.ok(Date.now() - start < 2000, "rejected after " + (Date.now() - start) + " ms, not at once");
    } finally {
        restoreStartType();
    }
    (await Gamepad.create()).destroy();
});

test("an installed driver at the oldest version this addon takes works, with an update available", { "skip": skipNotAdmin }, async function() {
    const { required, available } = Gamepad.getDriverStatus();
    if (required === available) {
        return;     // nothing older to pretend
    }
    await withRegistryVersion(required, async function(status) {
        assert.equal(status["isOutdated"], false);
        assert.equal(status["isUpdateAvailable"], true);
        // the running parts are newer than that: fine
        const gamepad = await Gamepad.create();
        gamepad.destroy();
    });
});

test("an installed driver older than this addon takes is outdated", { "skip": skipNotAdmin }, async function() {
    await withRegistryVersion(Gamepad.getDriverStatus()["required"] - 1, async function(status) {
        assert.equal(status["isOutdated"], true);
        await assert.rejects(Gamepad.create(), { "code": "EASYCONTROL_DRIVER_OUTDATED", "message": /installDriver/ });
    });
});

test("a newer installed driver is not replaced, and one that does not run yet is told", { "skip": skipNotAdmin }, async function() {
    await withRegistryVersion(99, async function(status) {
        assert.equal(status["isOutdated"], false);
        assert.equal(status["isUpdateAvailable"], false);
        const logBefore = fs.existsSync(SETUP_LOG) ? fs.readFileSync(SETUP_LOG, "utf8") : "";
        // resolves at once: no setup started, no UAC prompt
        assert.equal(await Gamepad.installDriver(), undefined);
        assert.equal(fs.existsSync(SETUP_LOG) ? fs.readFileSync(SETUP_LOG, "utf8") : "", logBefore, "the setup did not run");
        // the setup script refuses on its own too, as when run by hand
        let exitCode = 0;
        try {
            execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SETUP_SCRIPT, "install"], { "encoding": "utf8" });
        } catch (error) {
            exitCode = error.status;
        }
        assert.equal(exitCode, 2, "the setup refuses to install over a newer version");
        // the service and the driver say they are older than the registry
        await assert.rejects(Gamepad.create(), { "code": "EASYCONTROL_DRIVER_RESTART_NEEDED" });
    });
    assertInstalled();
});

