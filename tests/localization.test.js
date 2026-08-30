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
// completeness check catches a key that never got its second language

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

//
// The browser dictionary
//
test("the client dictionary has every language on every key", () => {
    const found = leaves(localization["dict"]);
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

test("every data-i18n key in the markup resolves", async () => {
    const html = await fs.readFile(path.join(webPath, "index.html"), "utf8");
    const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(function(match) {
        return match[1];
    });
    assert.equal(keys.length > 0, true, "no data-i18n attributes found, the scanner is broken");

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
