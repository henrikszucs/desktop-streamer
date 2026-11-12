"use strict";

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { Control, Platform, distPath, platformDir, rootPath } from "./helpers.js";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(await fs.readFile(path.join(rootPath, "package.json"), "utf8"));

// every function of each object, as the README and easy-control.d.ts give them
const API = {
    "Mouse": ["getX", "getY", "getPosition", "getIcon", "getIconId", "setX", "setY", "setPosition",
        "moveBy", "moveByX", "moveByY", "buttonDown", "buttonUp", "releaseAll", "scrollDown", "scrollUp", "scroll"],
    "Keyboard": ["keyDown", "keyUp", "releaseAll", "isKeySupported", "type", "getLockState",
        "getLayout", "setLayout", "GetLayout", "SetLayout"],
    "Gamepad": ["list", "create", "getDriverStatus", "installDriver", "uninstallDriver"],
    "Screen": ["list"],
    "Platform": ["hasInputAccess", "requestInputAccess", "getInputBlock"]
};

test("dist holds the native addon for the running platform", async function() {
    const stat = await fs.stat(path.join(distPath, platformDir, "easy-control.node"));
    assert.ok(stat.size > 0);
});

test("dist loaders carry the version banner", async function() {
    const banner = "/*! " + pkg["name"] + " v" + pkg["version"] + " | " + pkg["license"];
    for (const file of ["easy-control.cjs", "easy-control.mjs"]) {
        const code = await fs.readFile(path.join(distPath, file), "utf8");
        assert.ok(code.startsWith(banner), file + " starts with " + banner);
    }
});

test("CommonJS loader exports Mouse, Keyboard, Gamepad, Screen and Platform", function() {
    assert.deepEqual(Object.keys(Control).sort(), ["Gamepad", "Keyboard", "Mouse", "Platform", "Screen"]);
});

test("ES module loader has the same objects as named and default exports", async function() {
    const esm = await import("../../dist/easy-control.mjs");
    assert.equal(esm.default, Control);
    for (const name of Object.keys(API)) {
        assert.equal(esm[name], Control[name], name);
    }
});

test("the package name resolves to the dist loaders, for require and import", async function() {
    assert.equal(require("easy-control"), Control);
    assert.equal((await import("easy-control")).default, Control);
});

test("the addon can be required directly by absolute path, with the same objects", function() {
    const direct = require(path.join(distPath, platformDir, "easy-control.node"));
    for (const name of ["Mouse", "Keyboard", "Gamepad", "Screen"]) {
        assert.equal(direct[name], Control[name], name);
    }
});

test("every API member is a function, and there are no others", function() {
    for (const [object, members] of Object.entries(API)) {
        for (const member of members) {
            assert.equal(typeof Control[object][member], "function", object + "." + member);
        }
        const functions = Object.keys(Control[object]).filter(function(key) {
            return typeof Control[object][key] === "function";
        });
        assert.deepEqual(functions.sort(), [...members].sort(), object + " has exactly the documented functions");
    }
});

test("the addon's functions carry their names, for stack traces", function() {
    for (const [object, members] of Object.entries(API)) {
        if (object === "Platform") {
            continue;
        }
        for (const member of members) {
            // getLayout and GetLayout are one function
            assert.equal(Control[object][member].name.toLowerCase(), member.toLowerCase(), object + "." + member);
        }
    }
});

// runs a script in a child Node, which ends when the script does; its stdout
const runChild = function(lines) {
    return execFileSync(process.execPath, ["-e", lines.join("\n")], { "encoding": "utf8" });
};
const loaderPath = JSON.stringify(path.join(distPath, "easy-control.cjs"));

test("at exit, buttons are released even when releasing the keys throws", function() {
    // a stand-in addon: its keys cannot be released, its buttons say so when released
    const output = runChild([
        "const fs = require('node:fs');",
        "require.extensions['.node'] = function(module) {",
        "    module.exports = {",
        "        Platform: { getInputBlock() { return null; }, hasInputAccess() { return true; } },",
        "        Keyboard: { releaseAll() { throw new Error('blocked'); } },",
        "        Mouse: { releaseAll() { fs.writeSync(1, 'buttons released'); } },",
        "        Gamepad: {}, Screen: {}",
        "    };",
        "};",
        "require(" + loaderPath + ");"
    ]);
    assert.equal(output, "buttons released");
});

test("at exit, the addon's own releaseAll runs, not what an app put in its place", function() {
    const output = runChild([
        "const fs = require('node:fs');",
        "const control = require(" + loaderPath + ");",
        "control.Keyboard.releaseAll = function() { fs.writeSync(1, 'replacement called'); };",
        "control.Mouse.releaseAll = function() { fs.writeSync(1, 'replacement called'); };"
    ]);
    assert.equal(output, "");
});

test("Platform describes the running target", function() {
    assert.equal(Platform.target, os.platform() + "-" + os.arch());
    assert.deepEqual([...Platform.supportedTargets],
        ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]);
    assert.equal(Platform.isSupported, true);
    assert.equal(Platform.loadError, null);
    assert.equal(typeof Platform.hasInputAccess(), "boolean");
    assert.ok(Object.isFrozen(Platform));
});

test("Platform.getInputBlock is null or one of the documented reasons", function() {
    const block = Platform.getInputBlock();
    assert.ok(block === null || ["secure-desktop", "elevated-window", "secure-input", "no-permission"].includes(block), String(block));
    if (Platform.hasInputAccess() === false) {
        assert.notEqual(block, null, "no access is a reason");
    }
});

test("only the main thread releases held input when it ends", async function() {
    const { Worker } = await import("node:worker_threads");
    const before = process.listenerCount("exit");
    const worker = new Worker([
        "const { parentPort } = require('node:worker_threads');",
        "const before = process.listenerCount('exit');",
        "require(" + JSON.stringify(path.join(distPath, "easy-control.cjs")) + ");",
        "parentPort.postMessage([before, process.listenerCount('exit')]);"
    ].join("\n"), { "eval": true });
    const [workerBefore, workerAfter] = await new Promise(function(resolve, reject) {
        worker.once("message", resolve);
        worker.once("error", reject);
    });
    await worker.terminate();
    // (Node has an exit listener of its own in a worker)
    assert.equal(workerAfter, workerBefore, "a worker registers no exit hook: what is held is the whole process's");
    assert.equal(process.listenerCount("exit"), before);
});

test("Platform.requestInputAccess resolves with a boolean", { "skip": os.platform() === "darwin" && "shows the system prompt on macOS" }, async function() {
    assert.equal(await Platform.requestInputAccess(), Platform.hasInputAccess());
});

test("on an unsupported target the import works and every function says why", function() {
    // a child process that reports itself as a CPU no build exists for
    const script = [
        "Object.defineProperty(process, 'arch', { value: 'mips' });",
        "const c = require(" + JSON.stringify(path.join(distPath, "easy-control.cjs")) + ");",
        "const result = { isSupported: c.Platform.isSupported, loadError: c.Platform.loadError,",
        "    hasInputAccess: c.Platform.hasInputAccess(), target: c.Platform.target };",
        "try { c.Mouse.getX(); } catch (error) { result.mouseCode = error.code; result.mouseMessage = error.message; }",
        "try { c.Platform.getInputBlock(); } catch (error) { result.blockCode = error.code; }",
        // an app's test double replaces a stand-in's function, as on the addon's objects
        "c.Mouse.getX = function() { return 42; };",
        "result.replacedX = c.Mouse.getX();",
        "c.Gamepad.create().catch((error) => { result.gamepadCode = error.code; })",
        "    .then(() => c.Platform.requestInputAccess()).then((access) => { result.requestInputAccess = access;",
        "    console.log(JSON.stringify(result)); });"
    ].join("\n");
    const result = JSON.parse(execFileSync(process.execPath, ["-e", script], { "encoding": "utf8" }));
    assert.equal(result.isSupported, false);
    assert.equal(result.target, os.platform() + "-mips");
    assert.match(result.loadError, /no build for .*-mips; it supports darwin-arm64/);
    assert.equal(result.hasInputAccess, false);
    assert.equal(result.requestInputAccess, false);
    assert.equal(result.mouseCode, "EASYCONTROL_UNSUPPORTED_PLATFORM");
    assert.equal(result.mouseMessage, result.loadError);
    assert.equal(result.blockCode, "EASYCONTROL_UNSUPPORTED_PLATFORM");
    assert.equal(result.replacedX, 42, "a stand-in's function can be replaced");
    assert.equal(result.gamepadCode, "EASYCONTROL_UNSUPPORTED_PLATFORM", "a Promise function rejects rather than throws");
});
