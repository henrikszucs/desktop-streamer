"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

// first-party dependencies
import { argGet, binarySearch, setAbsolute, generateId, isDirEmpty } from "../src/server/common.js";

//
// argGet
//
test("argGet reads a flag as a boolean", () => {
    assert.equal(argGet(["node", "server.js", "--compile"], "--compile", false), true);
    assert.equal(argGet(["node", "server.js"], "--compile", false), undefined);
});

test("argGet reads --name=value only in the inline form", () => {
    const args = ["node", "server.js", "--configuration=./conf/config.json"];
    assert.equal(argGet(args, "--configuration", true, true), "./conf/config.json");

    // the caller asks for the inline form, so the separated one does not match
    const separated = ["node", "server.js", "--configuration", "./conf/config.json"];
    assert.equal(argGet(separated, "--configuration", true, true), undefined);
});

test("argGet reads -name value only in the separated form", () => {
    const args = ["node", "server.js", "-c", "./conf/config.json"];
    assert.equal(argGet(args, "-c", true, false), "./conf/config.json");

    const inline = ["node", "server.js", "-c=./conf/config.json"];
    assert.equal(argGet(inline, "-c", true, false), undefined);
});

test("argGet returns undefined for a value flag with nothing behind it", () => {
    assert.equal(argGet(["node", "server.js", "-c"], "-c", true, false), undefined);
});

//
// binarySearch
//
test("binarySearch finds a value and reports its index", () => {
    assert.deepEqual(binarySearch([1, 3, 5, 7], 1), [true, 0]);
    assert.deepEqual(binarySearch([1, 3, 5, 7], 5), [true, 2]);
    assert.deepEqual(binarySearch([1, 3, 5, 7], 7), [true, 3]);
});

test("binarySearch reports the insertion index of a missing value", () => {
    // refreshCache splices at this index, so it has to be the sorted position
    assert.deepEqual(binarySearch([1, 3, 5, 7], 0), [false, 0]);
    assert.deepEqual(binarySearch([1, 3, 5, 7], 4), [false, 2]);
    assert.deepEqual(binarySearch([1, 3, 5, 7], 9), [false, 4]);
    assert.deepEqual(binarySearch([], 1), [false, 0]);
});

test("binarySearch searches through a getter", () => {
    const arr = [{"p": 1}, {"p": 3}, {"p": 5}];
    const getVal = function(el) {
        return el["p"];
    };
    assert.deepEqual(binarySearch(arr, 3, getVal), [true, 1]);
    assert.deepEqual(binarySearch(arr, 4, getVal), [false, 2]);
});

//
// setAbsolute
//
test("setAbsolute joins a relative path to its origin", () => {
    const origin = path.resolve("/srv/conf");
    assert.equal(setAbsolute("database.db", origin), path.resolve(origin, "database.db"));
    assert.equal(setAbsolute("./sub/database.db", origin), path.resolve(origin, "sub/database.db"));
});

test("setAbsolute keeps an absolute path", () => {
    const absolute = path.resolve("/var/lib/database.db");
    assert.equal(setAbsolute(absolute, path.resolve("/srv/conf")), absolute);
});

//
// generateId
//
test("generateId returns the requested length from the requested alphabet", () => {
    assert.equal(generateId().length, 10);
    assert.equal(generateId(24).length, 24);
    assert.equal(generateId(0).length, 0);

    const id = generateId(200, "ab");
    assert.match(id, /^[ab]{200}$/);
});

//
// isDirEmpty
//
test("isDirEmpty tells an empty folder from a filled one", async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds-dir-"));
    t.after(async () => {
        await fs.rm(dir, {"recursive": true, "force": true});
    });

    const emptyPath = path.join(dir, "empty");
    const filledPath = path.join(dir, "filled");
    await fs.mkdir(emptyPath);
    await fs.mkdir(filledPath);
    await fs.writeFile(path.join(filledPath, "a.txt"), "x");

    assert.equal(await isDirEmpty(emptyPath), true);
    assert.equal(await isDirEmpty(filledPath), false);
});

test("isDirEmpty returns undefined for a folder that is not there", async () => {
    assert.equal(await isDirEmpty(path.join(os.tmpdir(), "ds-does-not-exist-" + generateId())), undefined);
});
