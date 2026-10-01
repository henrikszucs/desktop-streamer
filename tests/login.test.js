"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

// first-party dependencies
import LoginScreen from "../src/client/web/ui/management/login/index.js";
import localization from "../src/client/web/src/localization.js";

// the sign-in screen is UI, but what a person is told when a sign-in is refused
// is not the document's business: login() is a function over `ctx`, so it runs
// here the way the other client tests do - a fake shell in place of the screen,
// and nothing touched that a browser would have to provide. What it proves is
// the one thing the button cannot say for itself: that a refusal reaches the
// snackbar, as an error, in words that are in the dictionary.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGIN_DIR = path.join(HERE, "..", "src", "client", "web", "ui", "management", "login");

// the registry merges a module's slice before it mounts, so the test does too
const dictionary = JSON.parse(await fs.readFile(path.join(LOGIN_DIR, "localization.json"), "utf8"));
localization.add(dictionary);

// the reasons the screen knows by name, and the line each one is shown as
const REASONS = ["register-disabled", "email-taken", "invalid-credential"];

// a screen with the shell around it: what the snackbar was shown and where the
// client was sent, instead of a document to read either off
const buildScreen = function(error) {
    const shown = [];
    const routes = [];
    const screen = new LoginScreen();
    screen.ctx = {
        "localization": localization,
        "account": {
            "loginGoogle": async function(credential) {
                if (typeof error === "string") {
                    throw new Error(error);
                }
                return {"userId": "user-1", "email": "alice@example.com"};
            }
        },
        "ui": {
            "snackbar": {
                "show": function(message, isError = false) {
                    shown.push({"message": message, "isError": isError === true});
                }
            },
            "navigate": function(path) {
                routes.push(path);
            }
        }
    };
    return {"screen": screen, "shown": shown, "routes": routes};
};

// a refusal is logged as well as shown, and the log is not what is under test
const attempt = async function(screen, credential = "a-credential") {
    const held = console.error;
    console.error = function() {};
    try {
        await screen.login(credential);
    } finally {
        console.error = held;
    }
};

//
// a sign-in that is refused
//
test("a sign-in that fails says so in the snackbar, as an error, and goes nowhere", async () => {
    const {screen, shown, routes} = buildScreen("invalid-credential");
    await attempt(screen);

    assert.equal(shown.length, 1);
    assert.equal(shown[0]["isError"], true);
    assert.equal(shown[0]["message"], localization.get("login.error.invalid-credential"));
    assert.notEqual(shown[0]["message"], "");

    // the screen the person stood on is the screen they are still on
    assert.deepEqual(routes, []);
});

test("every reason the server can give is a line of its own", async () => {
    const lines = new Set();
    for (const reason of REASONS) {
        const {screen, shown} = buildScreen(reason);
        await attempt(screen);
        assert.equal(shown.length, 1);
        assert.equal(shown[0]["isError"], true);
        assert.equal(shown[0]["message"], localization.get("login.error." + reason));
        assert.notEqual(shown[0]["message"], "");
        lines.add(shown[0]["message"]);
    }
    assert.equal(lines.size, REASONS.length);      // and none of them is another
});

test("a reason the screen does not know is still a message, not an empty one", async () => {
    // `auth-disabled` is a real answer of the server, `boom` is nothing at all,
    // and a transport that gave up says something else again - all of them are
    // the general line rather than a raw error name or a blank snackbar
    for (const error of ["auth-disabled", "boom", "", "Failed to fetch"]) {
        const {screen, shown, routes} = buildScreen(error);
        await attempt(screen);
        assert.equal(shown.length, 1);
        assert.equal(shown[0]["isError"], true);
        assert.equal(shown[0]["message"], localization.get("login.error.failed"));
        assert.notEqual(shown[0]["message"], "");
        assert.deepEqual(routes, []);
    }
});

test("a refusal leaves the screen ready to be tried again", async () => {
    const {screen, shown} = buildScreen("invalid-credential");
    await attempt(screen);
    assert.equal(screen.isBusy, false);

    // the guard against a second credential arriving mid-flight must not be
    // what a person meets when they press the button again
    await attempt(screen);
    assert.equal(shown.length, 2);
});

test("no credential is no attempt, so nothing is said", async () => {
    const {screen, shown, routes} = buildScreen("invalid-credential");

    // what Google hands over when there is nothing in the event - the guard is
    // before the call, so there is nothing to log and nothing to say
    await screen.login(undefined);
    assert.deepEqual(shown, []);
    assert.deepEqual(routes, []);
    assert.equal(screen.isBusy, false);
});

//
// and the other way, so that the error is the difference and not the flow
//
test("a sign-in that works says so plainly and leaves for the home screen", async () => {
    const {screen, shown, routes} = buildScreen();
    await attempt(screen);
    assert.equal(shown.length, 1);
    assert.equal(shown[0]["isError"], false);
    assert.equal(shown[0]["message"], localization.get("login.done"));
    assert.notEqual(shown[0]["message"], "");
    assert.deepEqual(routes, ["new"]);
});

//
// the lines themselves
//
test("every line the screen can show is in the dictionary, in every language", () => {
    const keys = ["login.done", "login.error.failed"].concat(REASONS.map(function(reason) {
        return "login.error." + reason;
    }));
    for (const key of keys) {
        for (const lang of localization.supportedLanguages) {
            const line = localization.get(key, lang);
            assert.equal(typeof line, "string", key + " (" + lang + ") is missing");
            assert.notEqual(line, "", key + " (" + lang + ") is empty");
        }
    }
});
