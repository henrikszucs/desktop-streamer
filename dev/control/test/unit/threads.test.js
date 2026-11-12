"use strict";

// The addon from several worker threads at once: the X11 connection (Linux)
// and the shared state (macOS) are used under locks, so calls from four
// threads at once neither crash nor make Xlib report errors. Sends no input.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { Platform, distPath, inputBlock } from "./helpers.js";

// runs `calls` 2000 times in each of four workers, in a child process whose
// stderr shows what the system libraries report; the child's result
const runWorkers = function(calls) {
    const script = [
        "const { Worker } = require('node:worker_threads');",
        "const loader = " + JSON.stringify(path.join(distPath, "easy-control.cjs")) + ";",
        "const calls = " + JSON.stringify(calls) + ";",
        "Promise.all(calls.map(function(call) {",
        "    const worker = new Worker([",
        "        \"const { parentPort } = require('node:worker_threads');\",",
        "        \"const { Mouse, Keyboard, Screen } = require(\" + JSON.stringify(loader) + \");\",",
        "        \"for (let i = 0; i < 2000; i++) { \" + call + \"; }\",",
        "        \"parentPort.postMessage('done');\"",
        "    ].join('\\n'), { eval: true });",
        "    return new Promise(function(resolve, reject) {",
        "        worker.once('message', resolve);",
        "        worker.once('error', reject);",
        "    });",
        "})).then(function(results) {",
        "    console.log(JSON.stringify(results));",
        "}, function(error) {",
        "    console.error('worker failed: ' + error.message);",
        "    process.exit(1);",
        "});"
    ].join("\n");
    return spawnSync(process.execPath, ["-e", script], { "encoding": "utf8", "timeout": 110000 });
};

const assertAllDone = function(result, count) {
    assert.equal(result.stderr, "", "nothing on stderr (Xlib reports its errors there)");
    assert.equal(result.status, 0, "the process ended normally (signal " + result.signal + ")");
    assert.deepEqual(JSON.parse(result.stdout), new Array(count).fill("done"));
};

test("four workers reading the pointer, its icon, the layout and the screens at once", {
    "skip": os.platform() === "win32" && inputBlock === "secure-desktop" && "the pointer cannot be read on the secure desktop",
    "timeout": 120000
}, function() {
    assertAllDone(runWorkers(["Mouse.getX()", "Mouse.getIcon()", "Keyboard.getLayout()", "Screen.list()"]), 4);
});

test("macOS: four workers pressing modifiers and buttons at once keep their bookkeeping whole", {
    // without Accessibility the events are dropped, but what is held is still kept
    "skip": (os.platform() !== "darwin" && "macOS only") ||
        (Platform.hasInputAccess() && "would send real input here (Accessibility is granted)"),
    "timeout": 120000
}, function() {
    assertAllDone(runWorkers([
        "Keyboard.keyDown('ShiftLeft'); Keyboard.keyUp('ShiftLeft')",
        "Keyboard.keyDown('AltLeft'); Keyboard.keyUp('AltLeft')",
        "Mouse.buttonDown('left'); Mouse.buttonUp('left')",
        "Mouse.moveBy(1, 0); Mouse.scroll(0, 0.1)"
    ]), 4);
});
