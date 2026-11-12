"use strict";

// Keyboard.type on X11 with a layout whose characters need AltGr (Hungarian):
// a window of x11-key-window.c reports the keysyms it gets. It types for real
// into the focused window, so it runs only where EASYCONTROL_TYPING_TEST=1
// says that is fine - CI sets it under Xvfb.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { Keyboard, distPath, isX11 } from "./helpers.js";

const hasTool = function(command, args) {
    try {
        execFileSync(command, args, { "stdio": "ignore" });
        return true;
    } catch {
        return false;
    }
};

const skip = (!isX11 && "X11 only") ||
    (process.env["EASYCONTROL_TYPING_TEST"] !== "1" && "types for real; set EASYCONTROL_TYPING_TEST=1 to run it (CI does, under Xvfb)") ||
    (!hasTool("cc", ["--version"]) && "no C compiler") ||
    (!hasTool("setxkbmap", ["-query"]) && "no setxkbmap");

const windowExe = path.join(os.tmpdir(), "easy-control-x11-key-window");
let previousLayout = "us";

before(function() {
    if (skip) {
        return;
    }
    execFileSync("cc", ["-o", windowExe, path.join(import.meta.dirname, "x11-key-window.c"), "-lX11"]);
    const query = execFileSync("setxkbmap", ["-query"], { "encoding": "utf8" });
    previousLayout = (query.match(/^layout:\s*(\S+)/m) || [null, "us"])[1];
    execFileSync("setxkbmap", ["hu"]);
});

after(function() {
    if (!skip) {
        execFileSync("setxkbmap", [previousLayout]);
    }
});

// The keysyms the window gets while `send` runs (by default, type(text)), as
// the window's own XLookupString makes them: Shift, AltGr and Caps Lock
// applied, as an application gets them. `send` may be async.
const typeIntoWindow = async function(text, send) {
    const window = spawn(windowExe, [], { "stdio": ["ignore", "pipe", "inherit"] });
    let output = "";
    window.stdout.on("data", function(chunk) {
        output += chunk;
    });
    await new Promise(function(resolve, reject) {
        const timer = setTimeout(function() { reject(new Error("the key window did not start")); }, 5000);
        window.stdout.on("data", function() {
            if (output.includes("ready\n")) {
                clearTimeout(timer);
                resolve();
            }
        });
    });
    const exited = new Promise(function(resolve) {
        window.on("exit", resolve);
    });
    try {
        await (send !== undefined ? send() : Keyboard.type(text));
    } finally {
        await exited;
    }
    return output.split("\n").slice(1).filter(Boolean).map(function(hex) {
        return parseInt(hex, 16);
    });
};

// the keysyms of characters as XLookupString reports them: Latin-1 as
// itself, the rest as Unicode keysyms - but a layout's own keys give legacy
// keysyms (ő is 0x1f5), so tests on layout keys spell those out
const keysymsOf = function(text) {
    return Array.from(text).map(function(character) {
        const codepoint = character.codePointAt(0);
        return codepoint <= 0xff ? codepoint : (0x01000000 | codepoint);
    });
};

const hex = function(keysyms) {
    return keysyms.map(function(keysym) {
        return keysym.toString(16);
    });
};

const setCapsLock = function(isOn) {
    if (Keyboard.getLockState()["capsLock"] !== isOn) {
        Keyboard.keyDown("CapsLock");
        Keyboard.keyUp("CapsLock");
    }
    assert.equal(Keyboard.getLockState()["capsLock"], isOn, "Caps Lock " + (isOn ? "on" : "off"));
};

// runs fn with a layout (setxkbmap arguments), and Hungarian again after
const withLayout = async function(args, fn) {
    execFileSync("setxkbmap", args);
    try {
        await fn();
    } finally {
        execFileSync("setxkbmap", ["hu"]);
    }
};

test("type: plain, Shift and AltGr characters of a Hungarian layout", { skip, "timeout": 20000 }, async function() {
    // @ [ ] { } \ need AltGr on it, ő and é are keys of their own, Q needs Shift
    const keysyms = await typeIntoWindow("@[]{}\\őéQz");
    assert.deepEqual(keysyms.map(function(keysym) { return keysym.toString(16); }),
        [0x40, 0x5b, 0x5d, 0x7b, 0x7d, 0x5c, 0x1f5, 0xe9, 0x51, 0x7a].map(function(keysym) { return keysym.toString(16); }));
});

test("type: a character on no key of the layout comes through a borrowed key", { skip, "timeout": 20000 }, async function() {
    // the Unicode keysym of 日 (U+65E5), put on a spare keycode for the call
    const keysyms = await typeIntoWindow("日");
    assert.deepEqual(keysyms, [0x01000000 | 0x65e5]);
});

test("type: with Caps Lock on, text arrives as it is", { skip, "timeout": 60000 }, async function() {
    try {
        for (const layout of ["us", "hu"]) {
            await withLayout([layout], async function() {
                setCapsLock(true);
                assert.deepEqual(hex(await typeIntoWindow("aB1@")), hex(keysymsOf("aB1@")), layout + " layout");
            });
        }
        // borrowed keys: é and É are on no key of the US layout
        await withLayout(["us"], async function() {
            setCapsLock(true);
            assert.deepEqual(hex(await typeIntoWindow("éÉ")), hex(keysymsOf("éÉ")), "borrowed keys under Caps Lock");
        });
    } finally {
        setCapsLock(false);
    }
});

test("type: the active group of several is typed from, not the first", { skip, "timeout": 20000 }, async function() {
    await withLayout(["us,hu"], async function() {
        const first = Keyboard.getLayout();
        Keyboard.setLayout("Hungarian");
        try {
            assert.equal(Keyboard.getLayout(), "Hungarian");
            // odoubleacute (0x1f5) is the Hungarian layout's own key; a
            // borrowed key would give the Unicode keysym 0x1000151
            assert.deepEqual(hex(await typeIntoWindow("ő")), ["1f5"]);
        } finally {
            Keyboard.setLayout(first);
        }
    });
});

test("type: on a layout with no third level, plain and Shift characters arrive", { skip, "timeout": 20000 }, async function() {
    // no lv3 option: AltGr types nothing more, the map must not use it
    await withLayout(["us", "-option", ""], async function() {
        assert.deepEqual(hex(await typeIntoWindow("aA")), hex(keysymsOf("aA")));
    });
});

// keycodes the keymap leaves empty, as type() finds them
const spareKeycodeCount = function() {
    return execFileSync("xmodmap", ["-pke"], { "encoding": "utf8" }).split("\n").filter(function(line) {
        return /^keycode\s+\d+\s*=\s*$/.test(line);
    }).length;
};

test("type: when no spare key is left, the rest is typed and the call names what was not", {
    "skip": skip || (!hasTool("xmodmap", ["-pke"]) && "no xmodmap"), "timeout": 30000
}, async function() {
    const spare = spareKeycodeCount();
    assert.ok(spare > 0, "no spare keycode to borrow");
    // more distinct CJK characters than spare keys
    let text = "";
    for (let i = 0; i < spare + 3; i++) {
        text += String.fromCodePoint(0x4e00 + i);
    }
    let error = null;
    const keysyms = await typeIntoWindow(text, function() {
        try {
            Keyboard.type(text);
        } catch (thrown) {
            error = thrown;
        }
    });
    assert.ok(error !== null, "type() did not throw");
    assert.match(error.message, /no spare key left/);
    const last = (0x4e00 + spare + 2).toString(16).toUpperCase();
    assert.match(error.message, new RegExp("U\\+" + last), "the message names the last character");
    assert.deepEqual(hex(keysyms), hex(keysymsOf(text.slice(0, spare))), "the first ones arrived");
});

// a worker running `code` with Keyboard, Mouse, Screen and parentPort in scope;
// resolves with what it posts
const runWorker = function(code) {
    const worker = new Worker([
        "const { parentPort } = require('node:worker_threads');",
        "const { Keyboard, Mouse, Screen } = require(" + JSON.stringify(path.join(distPath, "easy-control.cjs")) + ");",
        code
    ].join("\n"), { "eval": true });
    return new Promise(function(resolve, reject) {
        worker.once("message", resolve);
        worker.once("error", reject);
    });
};

test("type: two workers typing at once each get their characters through, and the pointer does not wait", { skip, "timeout": 60000 }, async function() {
    // characters on no key of the layout: each call borrows keys and waits
    // 25 ms before giving them back, which must not hold the pointer up
    let pointer = null;
    const keysyms = await typeIntoWindow("", async function() {
        const pointerDone = runWorker([
            "let slowest = 0;",
            "let calls = 0;",
            "const end = Date.now() + 1500;",
            "while (Date.now() < end) {",
            "    const start = process.hrtime.bigint();",
            "    Mouse.moveBy(calls % 2 === 0 ? 1 : -1, 0);",
            "    Mouse.getX();",
            "    slowest = Math.max(slowest, Number(process.hrtime.bigint() - start) / 1e6);",
            "    calls++;",
            "}",
            "parentPort.postMessage({ slowest, calls });"
        ].join("\n"));
        const typed = await Promise.all([
            runWorker("for (let i = 0; i < 10; i++) { Keyboard.type('日本'); } parentPort.postMessage(true);"),
            runWorker("for (let i = 0; i < 10; i++) { Keyboard.type('中文'); } parentPort.postMessage(true);")
        ]);
        assert.deepEqual(typed, [true, true]);
        pointer = await pointerDone;
    });
    assert.ok(pointer["calls"] > 0, "the pointer worker made no call");
    assert.ok(pointer["slowest"] < 20, "a pointer call took " + pointer["slowest"].toFixed(1) + " ms while text was typed");
    const counts = {};
    for (const keysym of keysyms) {
        counts[keysym.toString(16)] = (counts[keysym.toString(16)] || 0) + 1;
    }
    const expected = {};
    for (const keysym of keysymsOf("日本中文")) {
        expected[keysym.toString(16)] = 10;
    }
    assert.deepEqual(counts, expected, "every character of both workers, none twice: no spare key was borrowed by both");
});
