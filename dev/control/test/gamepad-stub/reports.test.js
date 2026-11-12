"use strict";

// What the macOS gamepad sends, to the byte, read from the log of the stand-in
// for CoreHID (corehid-stub.swift). Run by run.js, which builds the addon with it:
// these tests make no sense against the real addon, and skip there.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { Gamepad, distPath } from "../unit/helpers.js";

const LOG = process.env["EC_STUB_LOG"];
const skip = !LOG && "only through run.js, with the stand-in for CoreHID";

const sleep = function(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
};

const logLines = function() {
    return fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean) : [];
};

const parseReport = function(hex) {
    const bytes = Buffer.from(hex, "hex");
    return {
        "length": bytes.length,
        "buttons": bytes[0] | bytes[1] << 8 | bytes[2] << 16,
        "leftX": bytes.readInt16LE(3),
        "leftY": bytes.readInt16LE(5),
        "rightX": bytes.readInt16LE(7),
        "rightY": bytes.readInt16LE(9),
        "leftTrigger": bytes[11],
        "rightTrigger": bytes[12]
    };
};

const reportsOf = function(serial) {
    return logLines().filter(function(line) {
        return line.startsWith("report " + serial + " ");
    }).map(function(line) {
        return parseReport(line.split(" ")[2]);
    });
};

const countOf = function(kind, serial) {
    return logLines().filter(function(line) {
        return line === kind + " " + serial;
    }).length;
};

// waits for a condition about the log, as reports reach it from another thread
const waitUntil = async function(what, condition, timeout = 5000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (condition()) {
            return;
        }
        await sleep(2);
    }
    assert.fail("timed out waiting for " + what);
};

// a pad, and what its newest device was made with
const createPad = async function(mode = "") {
    process.env["EC_STUB_MODE"] = mode;
    const gamepad = await Gamepad.create();
    const [, serial, descriptor, vendorId, productId] = logLines().filter(function(line) {
        return line.startsWith("new ");
    }).at(-1).split(" ");
    return { gamepad, serial, descriptor, vendorId, productId };
};

// the reports `send` makes: exactly `count`, and none after them
const reportsFrom = async function(serial, count, send) {
    const before = reportsOf(serial).length;
    send();
    await waitUntil(count + " reports", function() {
        return reportsOf(serial).length >= before + count;
    });
    await sleep(20);
    const reports = reportsOf(serial).slice(before);
    assert.equal(reports.length, count, "how many reports");
    return reports;
};

afterEach(function() {
    process.env["EC_STUB_MODE"] = "";
    for (const gamepad of Gamepad.list()) {
        gamepad.destroy();
    }
});

// the input items of a report descriptor, in order
const parseDescriptor = function(hex) {
    const data = Buffer.from(hex, "hex");
    const state = {};
    const items = [];
    let usages = [];
    let usageMin = null;
    let usageMax = null;
    let depth = 0;
    for (let i = 0; i < data.length;) {
        const prefix = data[i++];
        const size = [0, 1, 2, 4][prefix & 3];
        const type = (prefix >> 2) & 3;
        const tag = prefix >> 4;
        let value = 0;
        for (let k = 0; k < size; k++) {
            value |= data[i + k] << (8 * k);
        }
        i += size;
        if (type === 1) {
            if (tag === 0) state.page = value;
            if (tag === 1) state.logicalMin = size === 2 ? (value << 16) >> 16 : value;
            if (tag === 2) state.logicalMax = value;
            if (tag === 7) state.size = value;
            if (tag === 9) state.count = value;
        } else if (type === 2) {
            if (tag === 0) usages.push(value);
            if (tag === 1) usageMin = value;
            if (tag === 2) usageMax = value;
        } else if (tag === 10) {
            depth++;
            usages = [];    // a main item ends what the usages before it were for
        } else if (tag === 12) {
            depth--;
        } else if (tag === 8) {
            const ranged = usageMin === null ? [] : Array.from({ "length": usageMax - usageMin + 1 }, (_, k) => usageMin + k);
            items.push({ ...state, "isConstant": (value & 1) === 1, "usages": [...ranged, ...usages] });
            usages = [];
            usageMin = usageMax = null;
        }
    }
    return { items, depth };
};

test("the descriptor describes the 13 bytes sent, in the Standard Gamepad's order", { skip }, async function() {
    const { serial, descriptor, vendorId, productId } = await createPad();
    assert.equal(vendorId, "1209");
    assert.equal(productId, "1");
    const { items, depth } = parseDescriptor(descriptor);
    assert.equal(depth, 0, "its collections close");
    assert.equal(items.reduce(function(bits, item) {
        return bits + item.size * item.count;
    }, 0), 13 * 8);
    assert.deepEqual(items.map(function(item) {
        return [item.page, item.count, item.size, item.logicalMin, item.logicalMax, item.isConstant];
    }), [
        [9, 17, 1, 0, 1, false],            // the buttons
        [9, 7, 1, 0, 1, true],              // padding
        [1, 4, 16, -32768, 32767, false],   // the sticks
        [1, 2, 8, 0, 255, false]            // the triggers
    ]);
    assert.deepEqual(items[0].usages, Array.from({ "length": 17 }, (_, i) => i + 1));
    assert.deepEqual(items[2].usages, [0x30, 0x31, 0x32, 0x33]);
    assert.deepEqual(items[3].usages, [0x34, 0x35]);
    await waitUntil("the activation", function() {
        return countOf("active", serial) === 1;
    });
});

test("each button sets its own bit, and only that", { skip }, async function() {
    const { gamepad, serial } = await createPad();
    const reports = await reportsFrom(serial, 34, function() {
        for (let button = 0; button < 17; button++) {
            gamepad.buttonDown(button);
            gamepad.buttonUp(button);
        }
    });
    for (let button = 0; button < 17; button++) {
        assert.equal(reports[button * 2].length, 13);
        assert.equal(reports[button * 2].buttons, 1 << button, "button " + button + " down");
        assert.equal(reports[button * 2 + 1].buttons, 0, "button " + button + " up");
    }
});

test("each stick axis lands in its own field", { skip }, async function() {
    const { gamepad, serial } = await createPad();
    for (const [axis, field] of [[0, "leftX"], [1, "leftY"], [2, "rightX"], [3, "rightY"]]) {
        for (const value of [-1, -0.5, 0.5, 1, 0]) {
            const [report] = await reportsFrom(serial, 1, function() {
                gamepad.setAxis(axis, value);
            });
            assert.equal(report[field], Math.trunc(value * 32767), "axis " + axis + " at " + value);
        }
    }
});

test("a trigger's button pulls it fully and releases it, bit and analog together", { skip }, async function() {
    const { gamepad, serial } = await createPad();
    for (const [button, field] of [[6, "leftTrigger"], [7, "rightTrigger"]]) {
        const [down, up] = await reportsFrom(serial, 2, function() {
            gamepad.buttonDown(button);
            gamepad.buttonUp(button);
        });
        assert.equal(down[field], 255);
        assert.equal(down.buttons, 1 << button);
        assert.equal(up[field], 0);
        assert.equal(up.buttons, 0);
    }
});

test("a trigger's axis drives its analog value, and its bit from halfway", { skip }, async function() {
    const { gamepad, serial } = await createPad();
    for (const [axis, button, field] of [[4, 6, "leftTrigger"], [5, 7, "rightTrigger"]]) {
        for (const [value, amount, isPressed] of [[-1, 0, false], [-0.5, 64, false], [0, 128, true], [0.5, 191, true], [1, 255, true], [-1, 0, false]]) {
            const [report] = await reportsFrom(serial, 1, function() {
                gamepad.setAxis(axis, value);
            });
            assert.equal(report[field], amount, "axis " + axis + " at " + value);
            assert.equal(Boolean(report.buttons & (1 << button)), isPressed, "the bit of axis " + axis + " at " + value);
        }
    }
});

test("the button and the axis of a trigger do not disagree", { skip }, async function() {
    const { gamepad, serial } = await createPad();
    const [down, released] = await reportsFrom(serial, 2, function() {
        gamepad.buttonDown(6);
        gamepad.setAxis(4, -1);
    });
    assert.equal(down.buttons, 1 << 6);
    assert.equal(released.buttons, 0, "the axis released what the button pressed");
    assert.equal(released.leftTrigger, 0);
});

test("setState is one report; null keeps, and an explicit pressed stands", { skip }, async function() {
    const { gamepad, serial } = await createPad();
    let [report] = await reportsFrom(serial, 1, function() {
        gamepad.setState({ "buttons": [true, false, 0.5], "axes": [0.5, -0.5] });
    });
    assert.equal(report.buttons, 0b101);
    assert.equal(report.leftX, 16383);
    assert.equal(report.leftY, -16383);

    [report] = await reportsFrom(serial, 1, function() {
        gamepad.setState({ "buttons": [null, undefined, false] });
    });
    assert.equal(report.buttons, 0b001, "null and undefined keep, false clears");
    assert.equal(report.leftX, 16383, "what is not given is kept");

    // a browser's GamepadButton: pressed need not follow the value
    [report] = await reportsFrom(serial, 1, function() {
        gamepad.setState({ "buttons": [,,,,,, { "pressed": true, "value": 0.25 }, { "pressed": false, "value": 0.75 }] });
    });
    assert.equal(report.leftTrigger, 64);
    assert.equal(Boolean(report.buttons & (1 << 6)), true, "pressed below halfway");
    assert.equal(report.rightTrigger, 191);
    assert.equal(Boolean(report.buttons & (1 << 7)), false, "not pressed above halfway");

    [report] = await reportsFrom(serial, 1, function() {
        gamepad.setState({ "buttons": [,,,,,, 0.25], "axes": [,,,, 1] });
    });
    assert.equal(report.leftTrigger, 255, "axes come after the buttons and win");
    assert.equal(Boolean(report.buttons & (1 << 6)), true);
});

test("setState sends nothing when it is empty or wrong", { skip }, async function() {
    const { gamepad, serial } = await createPad();
    const [before] = await reportsFrom(serial, 1, function() {
        gamepad.setState({ "buttons": [true], "axes": [0.5] });
    });
    const count = reportsOf(serial).length;
    gamepad.setState({});
    gamepad.setState({ "buttons": [], "axes": [] });
    for (const wrong of [{ "buttons": [false, "x"] }, { "buttons": [2] }, { "axes": [0, 5] }, { "axes": "no" }, { "buttons": [false], "axes": [NaN] }]) {
        assert.throws(function() { gamepad.setState(wrong); }, JSON.stringify(wrong));
    }
    await sleep(50);
    assert.equal(reportsOf(serial).length, count);
    const [after] = await reportsFrom(serial, 1, function() {
        gamepad.buttonUp(16);
    });
    assert.deepEqual(after, before, "nothing changed either");
});

test("20000 reports arrive, in order", { skip, "timeout": 60000 }, async function() {
    const { gamepad, serial } = await createPad();
    const reports = await reportsFrom(serial, 20000, function() {
        for (let i = 0; i < 20000; i++) {
            gamepad.setAxis(0, (i % 32767) / 32767);
        }
    });
    reports.forEach(function(report, i) {
        assert.equal(report.leftX, Math.trunc((i % 32767) / 32767 * 32767), "report " + i);
    });
});

test("pads stay apart, each with its own serial number", { skip }, async function() {
    const first = await createPad();
    const second = await createPad();
    assert.notEqual(first.serial, second.serial);
    assert.equal(Gamepad.list().length, 2);
    const [a] = await reportsFrom(first.serial, 1, function() {
        first.gamepad.buttonDown(1);
    });
    const [b] = await reportsFrom(second.serial, 1, function() {
        second.gamepad.buttonDown(2);
    });
    assert.equal(a.buttons, 1 << 1);
    assert.equal(b.buttons, 1 << 2);
});

test("destroy lets the device go, and a worker ending does too", { skip }, async function() {
    const { gamepad, serial } = await createPad();
    gamepad.buttonDown(0);
    gamepad.destroy();
    gamepad.destroy();
    await waitUntil("the device to go", function() {
        return countOf("gone", serial) === 1;
    });

    const worker = new Worker("const { Gamepad } = require(" + JSON.stringify(path.join(distPath, "easy-control.cjs")) + ");" +
        "Gamepad.create().then(function(pad) { pad.buttonDown(3); setTimeout(function() { process.exit(0); }, 50); });", { "eval": true });
    await new Promise(function(resolve, reject) {
        worker.on("error", reject);
        worker.on("exit", resolve);
    });
    const workerSerial = logLines().filter(function(line) {
        return line.startsWith("new ");
    }).at(-1).split(" ")[1];
    await waitUntil("the worker's device to go", function() {
        return countOf("gone", workerSerial) === 1;
    });
    assert.deepEqual(Gamepad.list(), []);
});

test("create() rejects when there is no device", { skip }, async function() {
    process.env["EC_STUB_MODE"] = "nil";
    await assert.rejects(Gamepad.create(), { "code": "EASYCONTROL_CREATE_FAILED", "message": /entitlement/ });
    assert.deepEqual(Gamepad.list(), []);
});

test("create() rejects when the activation does not finish, and lets the device go", { skip, "timeout": 20000 }, async function() {
    process.env["EC_STUB_MODE"] = "hang";
    const start = Date.now();
    await assert.rejects(Gamepad.create(), { "code": "EASYCONTROL_CREATE_FAILED", "message": /did not finish within 5 s/ });
    assert.ok(Date.now() - start >= 4900, "it waited");
    assert.deepEqual(Gamepad.list(), []);
    const serial = logLines().filter(function(line) {
        return line.startsWith("new ");
    }).at(-1).split(" ")[1];
    await waitUntil("the device to go", function() {
        return countOf("gone", serial) === 1;
    }, 10000);
});

test("after a failed report the next call throws, then calls work again", { skip }, async function() {
    const message = { "message": "Failed to update gamepad state" };
    const { gamepad, serial } = await createPad("report-fails:3");
    const failedSoFar = function(count) {
        return waitUntil("failed report " + count, function() {
            return countOf("report-failed", serial) === count;
        });
    };

    gamepad.buttonDown(0);          // goes out, and fails
    await failedSoFar(1);
    assert.throws(function() { gamepad.buttonDown(1); }, message);
    await failedSoFar(2);
    assert.throws(function() { gamepad.setAxis(0, 0.5); }, message);
    await failedSoFar(3);
    assert.throws(function() { gamepad.setState({ "buttons": [true], "axes": [0, 0.25] }); }, message);

    // that call's report still went, and it is the first to arrive: nothing is stuck
    await waitUntil("the report after the failures", function() {
        return reportsOf(serial).length === 1;
    });
    const [recovered] = reportsOf(serial);
    assert.equal(recovered.buttons, 0b11, "what the failed calls changed is kept");
    assert.equal(recovered.leftY, 8191);

    const [next] = await reportsFrom(serial, 1, function() {
        gamepad.buttonUp(0);
    });
    assert.equal(next.buttons, 0b10);
});
