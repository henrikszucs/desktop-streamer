"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

// first-party dependencies
import localization from "../src/client/web/src/localization.js";

// a missing translation degrades quietly: get() warns and returns "", so only a
// completeness check catches a key that never got its second language. The
// dictionary is split now - the core carries the shell strings and every UI
// module ships its own localization.json - so both checks below walk the whole
// tree.

const repoPath = path.resolve(import.meta.dirname, "..");
const webPath = path.join(repoPath, "src", "client", "web");

const LANGUAGES = ["en", "hu"];

// a leaf is the node holding the languages, its values are the strings
const isLeaf = function(node) {
    return Object.values(node).every(function(value) {
        return typeof value === "string";
    });
};

// walk a dictionary and hand back [dottedKey, leaf] for every leaf in it
const leaves = function(dict, prefix = "") {
    const found = [];
    for (const [key, value] of Object.entries(dict)) {
        if (typeof value !== "object" || value === null) {
            continue;
        }
        const dotted = (prefix === "" ? key : prefix + "." + key);
        if (isLeaf(value) === true) {
            found.push([dotted, value]);
        } else {
            found.push(...leaves(value, dotted));
        }
    }
    return found;
};

const keysOf = function(dict) {
    return new Set(leaves(dict).map(function(entry) {
        return entry[0];
    }));
};

// the shell slice, taken before a module slice is merged into it - add() grows
// the one dictionary object the core exports, so this is the only moment the
// shell keys stand alone
const SHELL_KEYS = keysOf(localization["dict"]);

// every file of the client tree, whatever its extension
const clientFiles = async function(extension) {
    const entries = await fs.readdir(webPath, {"recursive": true});
    const found = [];
    for (const entry of entries) {
        if (path.extname(entry).toLowerCase() !== extension) {
            continue;
        }
        if (entry.split(path.sep).includes("libs") === true) {
            continue;
        }
        if ((await fs.stat(path.join(webPath, entry))).isDirectory() === true) {
            continue;
        }
        found.push(entry);
    }
    return found;
};

// the slice every UI module ships, by the folder shipping it
const moduleSlices = async function() {
    const slices = new Map();
    for (const file of await clientFiles(".json")) {
        if (path.basename(file) !== "localization.json") {
            continue;
        }
        slices.set(path.dirname(file), JSON.parse(await fs.readFile(path.join(webPath, file), "utf8")));
    }
    return slices;
};

// the core slice plus every module slice, the way the client builds it at runtime
const wholeDictionary = async function() {
    for (const slice of (await moduleSlices()).values()) {
        localization["add"](slice);
    }
    return localization["dict"];
};

//
// The browser dictionary
//
test("the client dictionary has every language on every key", async () => {
    const found = leaves(await wholeDictionary());
    assert.equal(found.length > 0, true, "no dictionary entries found, the walker is broken");

    const missing = [];
    for (const [key, leaf] of found) {
        for (const lang of LANGUAGES) {
            if (typeof leaf[lang] !== "string" || leaf[lang] === "") {
                missing.push(key + " (" + lang + ")");
            }
        }
    }
    assert.deepEqual(missing, []);
});

test("the client reports the languages the dictionary carries", () => {
    for (const lang of LANGUAGES) {
        assert.equal(localization["supportedLanguages"].includes(lang), true, "missing language: " + lang);
    }
});

test("every data-localization key in the markup resolves", async () => {
    await wholeDictionary();

    // the keys live in the shell, in the view fragments, and in the markup the
    // repeated components build from a template literal
    const keys = [];
    for (const extension of [".html", ".js"]) {
        for (const file of await clientFiles(extension)) {
            const code = await fs.readFile(path.join(webPath, file), "utf8");
            keys.push(...[...code.matchAll(/data-localization="([^"]+)"/g)].map(function(match) {
                return match[1];
            }));
        }
    }
    assert.equal(keys.length > 0, true, "no data-localization attributes found, the scanner is broken");

    const missing = [];
    for (const key of new Set(keys)) {
        for (const lang of LANGUAGES) {
            if (localization["get"](key, lang) === "") {
                missing.push(key + " (" + lang + ")");
            }
        }
    }
    assert.deepEqual(missing, []);
});

test("no module leans on the dictionary slice of another module", async () => {
    // a module may use its own strings, the ones the shell carries, and the ones
    // of the dialog it is a window of - anything else and it stops translating
    // the moment that other module is not loaded

    // the keys of every slice in the tree, by the folder that ships it
    const slices = new Map();
    for (const [folder, dict] of await moduleSlices()) {
        slices.set(folder, keysOf(dict));
    }
    assert.equal(slices.size > 1, true, "no dictionary slices found, the walker is broken");

    const missing = [];
    for (const file of await clientFiles(".html")) {
        const folder = path.dirname(file);
        if (folder === ".") {
            continue;   // the shell, its keys are the core slice
        }
        const code = await fs.readFile(path.join(webPath, file), "utf8");
        const keys = new Set([...code.matchAll(/data-localization="([^"]+)"/g)].map(function(match) {
            return match[1];
        }));
        if (keys.size === 0) {
            continue;
        }

        // the shell, this module, and the modules it is nested in
        const allowed = new Set(SHELL_KEYS);
        let current = folder;
        while (current.startsWith("ui") === true) {
            for (const key of slices.get(current) ?? []) {
                allowed.add(key);
            }
            current = path.dirname(current);
        }
        if (slices.has(folder) === false && keys.size > 0) {
            const own = [...keys].filter(function(key) { return allowed.has(key) === false; });
            if (own.length > 0) {
                missing.push(folder + " has " + own.length + " data-localization keys of its own and no localization.json");
                continue;
            }
        }
        for (const key of keys) {
            if (allowed.has(key) === false) {
                missing.push(folder + " asks for " + key + " which no slice it can see carries");
            }
        }
    }
    assert.deepEqual(missing, []);
});

test("get returns an empty string for a key that is not there", () => {
    assert.equal(localization["get"]("no.such.key", "en"), "");
});

//
// The server dictionary
//
test("the server dictionary has every language on every key", async () => {
    const dict = JSON.parse(await fs.readFile(path.join(repoPath, "src", "server", "localization.json"), "utf8"));
    const found = leaves(dict);
    assert.equal(found.length > 0, true, "no dictionary entries found, the walker is broken");

    const missing = [];
    for (const [key, leaf] of found) {
        for (const lang of LANGUAGES) {
            if (typeof leaf[lang] !== "string") {
                missing.push(key + " (" + lang + ")");
            }
        }
    }
    assert.deepEqual(missing, []);
});

//
// putParameters
//
test("putParameters substitutes every parameter it is given", () => {
    const result = localization["putParameters"]("Hi {name}, you have {count} messages", new Map([
        ["name", "Ann"],
        ["count", "3"]
    ]));
    assert.equal(result, "Hi Ann, you have 3 messages");
});

test("putParameters repeats a parameter used more than once", () => {
    const result = localization["putParameters"]("{a} and {a}", new Map([["a", "x"]]));
    assert.equal(result, "x and x");
});

test("putParameters leaves an unknown placeholder alone", () => {
    assert.equal(localization["putParameters"]("Hi {name}", new Map()), "Hi {name}");
});

test("putParameters unescapes a literal brace without substituting it", () => {
    assert.equal(localization["putParameters"]("\\{name\\}", new Map([["name", "Ann"]])), "{name}");
});
