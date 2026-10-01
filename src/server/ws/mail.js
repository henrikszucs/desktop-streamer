"use strict";

// the one thing the server mails: the key that confirms an account deletion
// (see handlers/accounts.js). The transport is built from `ws.email` in
// start() and verified there, so a server that cannot send is one that does
// not boot rather than one that answers "sent" to a click and mails nothing.
// The lines of the mail are the server's own dictionary, src/server/
// localization.json, the one slice of text that is written by the server and
// not by a client module, read through the server's localization module.

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import fs from "node:fs/promises";

// third-party dependencies
import nodemailer from "nodemailer";

// first-party dependencies
import localization from "../localization.js";
import { getPublicAddress, getPublicWsAddress } from "../config.js";

const DICTIONARY_PATH = path.join(import.meta.dirname, "..", "localization.json");

// the name the mail is signed with, so the person can tell where it came
// from; the client names itself the same way (src/client/web/src/desktop.js)
const APP_NAME = "Desktop Streamer";

// the language a mail falls back to when the client asked in one the
// dictionary does not hold
const DEFAULT_LANGUAGE = "en";

// the port SMTP over TLS is spoken on from the first byte; anything else is
// plaintext upgraded with STARTTLS, which nodemailer does on its own
const SMTPS_PORT = 465;

// the dictionary file into the localization module, which holds it from then on
const loadDictionary = async function() {
    localization.load(JSON.parse(await fs.readFile(DICTIONARY_PATH, "utf8")));
};

// one line of the dictionary, in the language asked for or the default one
const textOf = function(key, lang) {
    return localization.get(key, lang) || localization.get(key, DEFAULT_LANGUAGE) || "";
};

// the subject and body of the key mail. `{app}` is the application, `{domain}`
// names the server the account is on and `{key}` is what the person types back.
const buildDeleteMail = function(lang, domain, key) {
    const params = new Map([["app", APP_NAME], ["domain", domain], ["key", key]]);
    return {
        "subject": localization.putParameters(textOf("delete.subject", lang), params),
        "text": localization.putParameters(textOf("delete.body", lang), params)
    };
};

// the transport, verified, or null when the configuration names no SMTP
// server - in which case no account can be deleted, and the call says so
const createMailer = async function(conf) {
    const email = conf?.["ws"]?.["email"];
    if (typeof email !== "object" || email === null) {
        return null;
    }

    let auth = null;
    if (email["auth"]["type"] === "password") {
        auth = {
            "user": email["user"],
            "pass": email["auth"]["password"]
        };
    } else {
        auth = {
            "type": "OAuth2",
            "user": email["user"],
            "clientId": email["auth"]["clientId"],
            "clientSecret": email["auth"]["clientSecret"],
            "refreshToken": email["auth"]["refreshToken"]
        };
    }
    const transport = nodemailer.createTransport({
        "host": email["host"],
        "port": email["port"],
        "secure": email["port"] === SMTPS_PORT,
        "auth": auth
    });

    // a transport that cannot sign in throws here, at boot, where it is read
    await transport.verify();
    await loadDictionary();

    // the server is named to the person by the address they reach it at, which
    // is the proxy's where one stands in front of it and never the socket's
    const domain = (getPublicAddress(conf, "http") ?? getPublicWsAddress(conf))["domain"];

    return {
        // the languages the mail can be written in
        "languages": localization.supportedLanguages,

        // the key to the address of the account, in the client's language
        async sendDeleteKey(to, lang, key) {
            const mail = buildDeleteMail(lang, domain, key);
            await transport.sendMail({
                "from": {"name": APP_NAME, "address": email["user"]},
                "to": to,
                "subject": mail["subject"],
                "text": mail["text"]
            });
        },

        close() {
            transport.close();
        }
    };
};

export { createMailer, buildDeleteMail, loadDictionary, APP_NAME, DEFAULT_LANGUAGE };
export default { createMailer, buildDeleteMail, loadDictionary, APP_NAME, DEFAULT_LANGUAGE };
