"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import localization from "../src/server/localization.js";
import { createMailer, buildDeleteMail, loadDictionary, APP_NAME, DEFAULT_LANGUAGE } from "../src/server/ws/mail.js";

// the transport itself is SMTP and is not tested here; what is, is the mail
// that goes through it and that no mailer is built without a configuration

test("no email configuration builds no mailer", async () => {
    assert.equal(await createMailer({"ws": {"domain": "localhost"}}), null);
    assert.equal(await createMailer(undefined), null);
});

test("the delete mail carries the application, the key and the domain in the language asked for", async () => {
    await loadDictionary();
    const languages = localization.supportedLanguages;
    assert.equal(languages.length > 0, true, "the dictionary holds no language");
    for (const lang of languages) {
        const mail = buildDeleteMail(lang, "example.org", "AbC123xyz0");
        assert.equal(mail["subject"].includes(APP_NAME), true, lang + " subject names the application");
        assert.equal(mail["text"].includes(APP_NAME), true, lang + " body names the application");
        assert.equal(mail["subject"].includes("example.org"), true, lang + " subject names the domain");
        assert.equal(mail["text"].includes("AbC123xyz0"), true, lang + " body carries the key");
        assert.equal(mail["text"].includes("{"), false, lang + " body has no parameter left");
        assert.equal(mail["subject"].includes("{"), false, lang + " subject has no parameter left");
    }
});

test("a language the dictionary does not hold falls back to the default one", async () => {
    await loadDictionary();
    const fallback = buildDeleteMail("xx", "example.org", "k");
    const wanted = buildDeleteMail(DEFAULT_LANGUAGE, "example.org", "k");
    assert.deepEqual(fallback, wanted);
    assert.deepEqual(buildDeleteMail("", "example.org", "k"), wanted);
});
