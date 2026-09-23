"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { pickName, pickSystemName } from "../src/client/web/src/appname.js";

//
// pickName - the title, in the client's language
//
test("pickName takes the name of the language asked for", () => {
    const names = {"en": "Streamer", "hu": "Közvetítő"};
    assert.equal(pickName(names, "hu"), "Közvetítő");
    assert.equal(pickName(names, "en"), "Streamer");
});

test("pickName falls from a regional language to its base and to a variant of it", () => {
    assert.equal(pickName({"en": "Streamer", "hu": "Közvetítő"}, "hu-HU"), "Közvetítő");
    assert.equal(pickName({"en": "Streamer", "pt-BR": "Transmissor"}, "pt"), "Transmissor");
    assert.equal(pickName({"en": "Streamer", "pt-BR": "Transmissor", "pt": "Emissor"}, "pt-BR"), "Transmissor");
});

test("pickName falls back to English, then to the first name given", () => {
    assert.equal(pickName({"hu": "Közvetítő", "en": "Streamer"}, "de"), "Streamer");
    assert.equal(pickName({"hu": "Közvetítő", "fr": "Diffuseur"}, "de"), "Közvetítő");
});

test("pickName answers null where nothing is configured", () => {
    assert.equal(pickName(undefined, "en"), null);
    assert.equal(pickName(null, "en"), null);
    assert.equal(pickName({}, "en"), null);
});

//
// pickSystemName - the auto-launch entry, in no language the system follows
//
test("pickSystemName takes the English name whatever the language", () => {
    assert.equal(pickSystemName({"hu": "Közvetítő", "en": "Streamer"}, "Fallback"), "Streamer");
});

test("pickSystemName takes the first name where there is no English one", () => {
    assert.equal(pickSystemName({"hu": "Közvetítő", "de": "Übertragung"}, "Fallback"), "Közvetítő");
});

test("pickSystemName takes the dictionary's name where nothing is configured", () => {
    assert.equal(pickSystemName(undefined, "Desktop Streamer"), "Desktop Streamer");
    assert.equal(pickSystemName({}, "Desktop Streamer"), "Desktop Streamer");
});

test("pickSystemName drops what a registry value, a file name or an AppleScript string cannot hold", () => {
    // a quote would end the AppleScript string the macOS login item is named in
    assert.equal(pickSystemName({"en": "My \"Streamer\""}, "Fallback"), "My Streamer");
    assert.equal(pickSystemName({"en": "a/b\\c:d*e?f<g>h|i"}, "Fallback"), "abcdefghi");
    assert.equal(pickSystemName({"en": "  two\tlines\nhere  "}, "Fallback"), "two lines here");
    assert.equal(pickSystemName({"en": "Streamer (local)"}, "Fallback"), "Streamer (local)");

    // and a name with nothing left is no name
    assert.equal(pickSystemName({"en": "\"/\\"}, "Desktop Streamer"), "Desktop Streamer");
});
