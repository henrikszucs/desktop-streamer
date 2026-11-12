"use strict";

import { test } from "node:test";
import assert from "node:assert/strict";

import { Mouse, Screen, inputBlock, isOnScreen, isX11 } from "./helpers.js";

test("Screen.list returns at least one screen with the documented fields", function() {
    const screens = Screen.list();
    assert.ok(Array.isArray(screens));
    assert.ok(screens.length >= 1, "no screen reported");
    for (const s of screens) {
        assert.deepEqual(Object.keys(s).sort(), ["height", "id", "isPrimary", "name", "scaleFactor", "width", "x", "y"]);
        assert.equal(typeof s["isPrimary"], "boolean");
        for (const field of ["width", "height", "x", "y", "scaleFactor"]) {
            assert.ok(Number.isFinite(s[field]), field + " is a finite number");
        }
        assert.ok(s["width"] > 0 && s["height"] > 0, "screen has an area");
        assert.ok(s["scaleFactor"] > 0, "scaleFactor is positive");
    }
});

test("exactly one screen is primary", function() {
    const primaries = Screen.list().filter(function(s) {
        return s["isPrimary"];
    });
    assert.equal(primaries.length, 1);
});

// X11 lets the primary output sit anywhere in the root window
test("the primary screen is at 0,0", { "skip": isX11 && "X11 can place the primary output anywhere" }, function() {
    const primary = Screen.list().find(function(s) {
        return s["isPrimary"];
    });
    assert.equal(primary["x"], 0);
    assert.equal(primary["y"], 0);
});

test("screens do not overlap in the logical space", function() {
    const screens = Screen.list();
    for (let i = 0; i < screens.length; i++) {
        for (let j = i + 1; j < screens.length; j++) {
            const a = screens[i];
            const b = screens[j];
            const isOverlap = a["x"] < b["x"] + b["width"] && b["x"] < a["x"] + a["width"] &&
                a["y"] < b["y"] + b["height"] && b["y"] < a["y"] + a["height"];
            assert.ok(!isOverlap, "screens " + i + " and " + j + " overlap");
        }
    }
});

test("the pointer position lies on a listed screen", { "skip": inputBlock === "secure-desktop" && "the secure desktop is showing: the pointer cannot be read" }, function() {
    const screens = Screen.list();
    assert.ok(isOnScreen(screens, Math.floor(Mouse.getX()), Math.floor(Mouse.getY())));
});

test("Screen.list is stable between calls", function() {
    assert.deepEqual(Screen.list(), Screen.list());
});

test("every screen has an id, unique, and a name", function() {
    const screens = Screen.list();
    for (const s of screens) {
        assert.equal(typeof s["id"], "string");
        assert.ok(s["id"].length > 0, "id is not empty");
        assert.equal(typeof s["name"], "string");
    }
    assert.equal(new Set(screens.map(function(s) { return s["id"]; })).size, screens.length, "ids are unique");
});
