"use strict";

// Moves the pointer (and puts it back), but never clicks or scrolls: those
// would land on whatever window is under it. The end-to-end suite
// (test/e2e) checks clicks and scrolling against a window of its own.

import { test, after } from "node:test";
import assert from "node:assert/strict";

import os from "node:os";

import { Mouse, Screen, inputBlock, isOnScreen, pixelTolerance, skipNoInputAccess } from "./helpers.js";

// where the pointer was, to put it back; on the secure desktop it cannot be read
const isPointerReadable = !(os.platform() === "win32" && inputBlock === "secure-desktop");
const startX = isPointerReadable ? Mouse.getX() : 0;
const startY = isPointerReadable ? Mouse.getY() : 0;
after(function() {
    if (isPointerReadable) {
        Mouse.setPosition(startX, startY);
    }
});

// macOS keeps fractions of a point, and sends the pointer by posted events that land late
const skipNoMacInput = (os.platform() !== "darwin" && "macOS only") || skipNoInputAccess;

const sleep = function(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
};

// past the moment a read still goes by the last move, so these are the system's own
const MOVE_SETTLED = 150;

const assertNear = function(actual, expected, tolerance, message) {
    assert.ok(Math.abs(actual - expected) <= tolerance, message + ": " + actual + " is not within " + tolerance + " of " + expected);
};

test("getX and getY return finite numbers", { "skip": !isPointerReadable && "the secure desktop is showing" }, function() {
    assert.ok(Number.isFinite(Mouse.getX()));
    assert.ok(Number.isFinite(Mouse.getY()));
});

test("on the secure desktop the pointer is not read, and the error says why", { "skip": isPointerReadable && "no secure desktop showing" }, function() {
    for (const fn of [Mouse.getX, Mouse.getY, Mouse.getPosition]) {
        assert.throws(fn, { "code": "EASYCONTROL_INPUT_BLOCKED", "message": /getInputBlock/ });
    }
});

test("getPosition returns getX and getY in one read", { "skip": !isPointerReadable && "the secure desktop is showing" }, function() {
    const position = Mouse.getPosition();
    assert.deepEqual(Object.keys(position).sort(), ["x", "y"]);
    assert.ok(Number.isFinite(position["x"]) && Number.isFinite(position["y"]));
    // the pointer may be moved by hand meanwhile; while it is still, they agree
    const tolerance = pixelTolerance(Screen.list());
    assertNear(position["x"], Mouse.getX(), tolerance, "x");
    assertNear(position["y"], Mouse.getY(), tolerance, "y");
});

test("a position read can be set back unchanged", { "skip": skipNoInputAccess }, function() {
    const x = Mouse.getX();
    const y = Mouse.getY();
    Mouse.setPosition(x, y);
    assertNear(Mouse.getX(), x, 0.01, "x");
    assertNear(Mouse.getY(), y, 0.01, "y");
});

test("setPosition reaches points on every screen", { "skip": skipNoInputAccess }, function() {
    const screens = Screen.list();
    const tolerance = pixelTolerance(screens);
    for (const s of screens) {
        const points = [
            [s["x"] + s["width"] / 2, s["y"] + s["height"] / 2],    // centre
            [s["x"] + 10, s["y"] + 10],                             // near top left
            [s["x"] + s["width"] - 10, s["y"] + s["height"] - 10]   // near bottom right
        ];
        for (const [x, y] of points) {
            Mouse.setPosition(x, y);
            assertNear(Mouse.getX(), x, tolerance, "x on screen at " + s["x"] + "," + s["y"]);
            assertNear(Mouse.getY(), y, tolerance, "y on screen at " + s["x"] + "," + s["y"]);
        }
    }
});

test("macOS: fractions of a point are kept, at once and after the posted move lands", { "skip": skipNoMacInput }, async function() {
    const primary = Screen.list().find(function(s) {
        return s["isPrimary"];
    });
    for (const fraction of [0.25, 0.5, 0.75, 0.3]) {
        const x = primary["x"] + 300 + fraction;
        const y = primary["y"] + 300 + (1 - fraction);
        Mouse.setPosition(x, y);
        assertNear(Mouse.getX(), x, 0.01, "x at once");
        assertNear(Mouse.getY(), y, 0.01, "y at once");
        await sleep(MOVE_SETTLED);
        assertNear(Mouse.getX(), x, 0.01, "x after it landed");
        assertNear(Mouse.getY(), y, 0.01, "y after it landed");
    }
});

test("macOS: off every screen the pointer stays on one, at once and after the posted move lands", { "skip": skipNoMacInput }, async function() {
    const screens = Screen.list();
    const left = Math.min(...screens.map(function(s) { return s["x"]; })) - 500;
    const top = Math.min(...screens.map(function(s) { return s["y"]; })) - 500;
    const right = Math.max(...screens.map(function(s) { return s["x"] + s["width"]; })) + 500;
    const bottom = Math.max(...screens.map(function(s) { return s["y"] + s["height"]; })) + 500;
    const primary = screens.find(function(s) {
        return s["isPrimary"];
    });
    const middleX = primary["x"] + primary["width"] / 2;
    const middleY = primary["y"] + primary["height"] / 2;
    for (const [x, y] of [[left, top], [right, top], [left, bottom], [right, bottom],
        [left, middleY], [right, middleY], [middleX, top], [middleX, bottom]]) {
        Mouse.setPosition(x, y);
        const name = "sent to " + x + "," + y;
        assert.ok(isOnScreen(screens, Mouse.getX(), Mouse.getY()), name + ": on a screen at once, at " + Mouse.getX() + "," + Mouse.getY());
        await sleep(MOVE_SETTLED);
        assert.ok(isOnScreen(screens, Mouse.getX(), Mouse.getY()), name + ": on a screen after it landed, at " + Mouse.getX() + "," + Mouse.getY());
    }
});

test("macOS: off one side of the only screen, the other axis keeps its fraction", {
    "skip": skipNoMacInput || (Screen.list().length !== 1 && "with several screens the nearest one may differ")
}, function() {
    const [screen] = Screen.list();
    Mouse.setPosition(screen["x"] - 500, screen["y"] + 300.5);
    assertNear(Mouse.getX(), screen["x"], 0.01, "x on the edge");
    assertNear(Mouse.getY(), screen["y"] + 300.5, 0.01, "y as it was sent");
});

test("macOS: moveBy keeps a fraction, and past an edge stays on a screen", { "skip": skipNoMacInput }, async function() {
    const screens = Screen.list();
    const primary = screens.find(function(s) {
        return s["isPrimary"];
    });
    const x = primary["x"] + 600.5;
    const y = primary["y"] + 400.5;
    Mouse.setPosition(x, y);
    Mouse.moveBy(10, 0);
    assertNear(Mouse.getX(), x + 10, 0.01, "there");
    Mouse.moveBy(-10, 0);
    assertNear(Mouse.getX(), x, 0.01, "and back");
    assertNear(Mouse.getY(), y, 0.01, "the other axis");

    for (const [dx, dy] of [[-100000, -100000], [100000, 100000]]) {
        Mouse.moveBy(dx, dy);
        assert.ok(isOnScreen(screens, Mouse.getX(), Mouse.getY()), "on a screen at once, at " + Mouse.getX() + "," + Mouse.getY());
        await sleep(MOVE_SETTLED);
        assert.ok(isOnScreen(screens, Mouse.getX(), Mouse.getY()), "on a screen after it landed, at " + Mouse.getX() + "," + Mouse.getY());
    }
});

// The moves posted before land after the next warp. Reads and moves going by
// what the system shows at that moment get an old position back: a design doing
// that failed 927 of these reads, where running the whole suite failed 5 times in 12.
test("macOS: a read straight after a move is that move, not one still on its way", { "skip": skipNoMacInput }, function() {
    const primary = Screen.list().find(function(s) {
        return s["isPrimary"];
    });
    const points = [[100, 100], [140, 140], [primary["width"] / 2, primary["height"] / 2], [10, 10],
        [primary["width"] - 10, primary["height"] - 10]].map(function([x, y]) {
        return [primary["x"] + x, primary["y"] + y];
    });
    const tolerance = pixelTolerance([primary]);
    for (let i = 0; i < 4000; i++) {
        const [x, y] = points[i % points.length];
        Mouse.setPosition(x, y);
        assertNear(Mouse.getX(), x, tolerance, "x of move " + i);
        assertNear(Mouse.getY(), y, tolerance, "y of move " + i);
    }
});

test("setX moves only horizontally and setY only vertically", { "skip": skipNoInputAccess }, function() {
    const primary = Screen.list().find(function(s) {
        return s["isPrimary"];
    });
    const tolerance = pixelTolerance([primary]);
    const x0 = primary["x"] + 100;
    const y0 = primary["y"] + 100;
    Mouse.setPosition(x0, y0);

    Mouse.setX(x0 + 50);
    assertNear(Mouse.getX(), x0 + 50, tolerance, "setX moved x");
    assertNear(Mouse.getY(), y0, tolerance, "setX kept y");

    Mouse.setY(y0 + 40);
    assertNear(Mouse.getX(), x0 + 50, tolerance, "setY kept x");
    assertNear(Mouse.getY(), y0 + 40, tolerance, "setY moved y");
});

test("getIcon returns an RGBA picture of the documented shape", function() {
    const icon = Mouse.getIcon();
    assert.deepEqual(Object.keys(icon).sort(), ["data", "height", "width", "xOffset", "yOffset"]);
    assert.ok(icon["data"] instanceof Uint8Array);
    assert.ok(Number.isInteger(icon["width"]) && icon["width"] >= 0);
    assert.ok(Number.isInteger(icon["height"]) && icon["height"] >= 0);
    assert.equal(icon["data"].length, icon["width"] * icon["height"] * 4);
    if (icon["width"] > 0) {
        // the hot spot lies inside the picture
        assert.ok(icon["xOffset"] >= 0 && icon["xOffset"] < icon["width"], "xOffset inside");
        assert.ok(icon["yOffset"] >= 0 && icon["yOffset"] < icon["height"], "yOffset inside");
        // a pointer picture is never fully transparent
        let isVisible = false;
        for (let i = 3; i < icon["data"].length; i += 4) {
            if (icon["data"][i] !== 0) {
                isVisible = true;
                break;
            }
        }
        assert.ok(isVisible, "some pixel has alpha");
    }
});

test("getIconId is a non-negative integer, stable while the shape does not change", function() {
    const id = Mouse.getIconId();
    assert.ok(Number.isInteger(id) && id >= 0);
    assert.equal(Mouse.getIconId(), id);
});

test("setPosition, setX and setY reject bad coordinates", function() {
    assert.throws(function() { Mouse.setPosition(); }, { "name": "TypeError", "message": "Expected 2 arguments" });
    assert.throws(function() { Mouse.setPosition(10); }, { "name": "TypeError", "message": "Expected 2 arguments" });
    assert.throws(function() { Mouse.setPosition("10", 10); }, { "name": "TypeError", "message": "Argument 1 must be a finite number" });
    assert.throws(function() { Mouse.setPosition(10, NaN); }, { "name": "TypeError", "message": "Argument 2 must be a finite number" });
    assert.throws(function() { Mouse.setPosition(Infinity, 10); }, TypeError);
    assert.throws(function() { Mouse.setX(); }, { "name": "TypeError", "message": "Expected 1 argument" });
    assert.throws(function() { Mouse.setX(null); }, TypeError);
    assert.throws(function() { Mouse.setY(); }, TypeError);
    assert.throws(function() { Mouse.setY(-Infinity); }, TypeError);
});

test("buttonDown and buttonUp reject unknown buttons", function() {
    for (const fn of [Mouse.buttonDown, Mouse.buttonUp]) {
        assert.throws(function() { fn(); }, { "name": "TypeError", "message": "Expected 1 argument" });
        assert.throws(function() { fn(0); }, { "name": "TypeError", "message": "Argument 1 must be a string" });
        assert.throws(function() { fn("LEFT"); }, TypeError);
        assert.throws(function() { fn("wheel"); }, TypeError);
    }
});

test("scrollDown and scrollUp need an amount and a direction flag", function() {
    for (const fn of [Mouse.scrollDown, Mouse.scrollUp]) {
        assert.throws(function() { fn(); }, TypeError);
        assert.throws(function() { fn(1); }, TypeError);
        assert.throws(function() { fn("1", false); }, TypeError);
        assert.throws(function() { fn(1, "no"); }, TypeError);
        assert.throws(function() { fn(NaN, false); }, { "name": "TypeError", "message": /finite/ });
        assert.throws(function() { fn(Infinity, true); }, TypeError);
    }
});

test("scrollDown and scrollUp refuse more than 10000 notches", function() {
    for (const fn of [Mouse.scrollDown, Mouse.scrollUp]) {
        assert.throws(function() { fn(1e9, false); }, { "name": "RangeError", "message": /10000/ });
        assert.throws(function() { fn(-10001, true); }, RangeError);
    }
});

test("scroll needs two finite numbers of at most 10000 notches", function() {
    assert.throws(function() { Mouse.scroll(); }, TypeError);
    assert.throws(function() { Mouse.scroll(1); }, TypeError);
    assert.throws(function() { Mouse.scroll(0, false); }, TypeError);
    assert.throws(function() { Mouse.scroll(NaN, 0); }, { "name": "TypeError", "message": /finite/ });
    assert.throws(function() { Mouse.scroll(0, 10001); }, { "name": "RangeError", "message": /10000/ });
    // nothing to scroll: sends nothing
    assert.equal(Mouse.scroll(0, 0), undefined);
});

test("moveBy needs two finite numbers of at most 100000 counts", function() {
    assert.throws(function() { Mouse.moveBy(); }, { "name": "TypeError", "message": "Expected 2 arguments" });
    assert.throws(function() { Mouse.moveBy(1); }, { "name": "TypeError", "message": "Expected 2 arguments" });
    assert.throws(function() { Mouse.moveBy("1", 0); }, TypeError);
    assert.throws(function() { Mouse.moveBy(Infinity, 0); }, { "name": "TypeError", "message": /finite/ });
    assert.throws(function() { Mouse.moveBy(0, -100001); }, { "name": "RangeError", "message": /100000/ });
});

test("moveBy moves the pointer that way, fractions adding up", { "skip": skipNoInputAccess }, function() {
    const primary = Screen.list().find(function(s) {
        return s["isPrimary"];
    });
    const x0 = primary["x"] + primary["width"] / 2;
    const y0 = primary["y"] + primary["height"] / 2;
    Mouse.setPosition(x0, y0);
    // the pointer speed and acceleration make the distance inexact: the sign is what is sure
    Mouse.moveBy(20, -20);
    assert.ok(Mouse.getX() > x0, "moved right");
    assert.ok(Mouse.getY() < y0, "moved up");
    Mouse.setPosition(x0, y0);
    Mouse.moveBy(0.4, 0);
    assertNear(Mouse.getX(), x0, pixelTolerance([primary]), "less than a count does not move");
    Mouse.moveBy(0.4, 0);
    Mouse.moveBy(0.4, 0);
    assert.ok(Mouse.getX() > x0, "three fractions make a count");
});

test("moveByX and moveByY need one finite number of at most 100000 counts", function() {
    for (const fn of [Mouse.moveByX, Mouse.moveByY]) {
        assert.throws(function() { fn(); }, { "name": "TypeError", "message": "Expected 1 argument" });
        assert.throws(function() { fn("1"); }, { "name": "TypeError", "message": "Argument 1 must be a finite number" });
        assert.throws(function() { fn(Infinity); }, { "name": "TypeError", "message": /finite/ });
        assert.throws(function() { fn(100001); }, { "name": "RangeError", "message": /100000/ });
        assert.throws(function() { fn(-100001); }, RangeError);
    }
});

test("moveByX moves only horizontally and moveByY only vertically", { "skip": skipNoInputAccess }, function() {
    const primary = Screen.list().find(function(s) {
        return s["isPrimary"];
    });
    const tolerance = pixelTolerance([primary]);
    const x0 = primary["x"] + primary["width"] / 2;
    const y0 = primary["y"] + primary["height"] / 2;
    Mouse.setPosition(x0, y0);
    Mouse.moveByX(20);
    assert.ok(Mouse.getX() > x0, "moveByX(20) moved right");
    assertNear(Mouse.getY(), y0, tolerance, "moveByX kept y");

    Mouse.setPosition(x0, y0);
    Mouse.moveByY(-20);
    assert.ok(Mouse.getY() < y0, "moveByY(-20) moved up");
    assertNear(Mouse.getX(), x0, tolerance, "moveByY kept x");
});

test("releaseAll with no button down does nothing and throws nothing", function() {
    assert.equal(Mouse.releaseAll(), undefined);
    assert.equal(Mouse.releaseAll(), undefined);
});

test("getIcon: fully transparent pixels are black, and it is empty exactly while getIconId is 0", function() {
    const id = Mouse.getIconId();
    const icon = Mouse.getIcon();
    if (id === 0) {
        assert.equal(icon["width"], 0, "hidden pointer, empty picture");
        assert.equal(icon["data"].length, 0);
        return;
    }
    assert.ok(icon["width"] > 0 && icon["height"] > 0, "a shown pointer has a picture");
    for (let i = 0; i < icon["data"].length; i += 4) {
        if (icon["data"][i + 3] === 0) {
            assert.ok(icon["data"][i] === 0 && icon["data"][i + 1] === 0 && icon["data"][i + 2] === 0,
                "transparent pixel " + (i / 4) + " is not black");
        }
    }
});
