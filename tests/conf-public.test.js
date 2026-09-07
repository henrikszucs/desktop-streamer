"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { buildPublicConf, confGet } from "../src/server/ws/handlers/conf.js";
import { ANSWER_TIMEOUT } from "../src/server/ws/notify.js";

// buildPublicConf is the boundary between the configuration file and every
// browser that connects: it is built once at start and handed out verbatim, so
// anything that reaches it reaches everybody. The tests below are as much about
// what is *not* in the answer as about what is.

// a configuration with every secret the schema accepts in it, so a field that
// leaks has something recognisable in it
const buildConf = function() {
    return {
        "http": {
            "domain": "localhost",
            "port": 8443,
            "key": "SECRET-HTTP-KEY-PEM",
            "cert": "SECRET-HTTP-CERT-PEM"
        },
        "ws": {
            "domain": "localhost",
            "port": 8444,
            "key": "SECRET-WS-KEY-PEM",
            "cert": "SECRET-WS-CERT-PEM",
            "database": {
                "type": "mysql",
                "host": "db.example.com",
                "port": 3306,
                "user": "SECRET-DB-USER",
                "pass": "SECRET-DB-PASS",
                "db": "SECRET-DB-NAME"
            },
            "webrtc": {
                "iceServers": ["stun:stun.example.com:3478"]
            },
            "email": {
                "host": "smtp.example.com",
                "port": 465,
                "user": "SECRET-SMTP-USER",
                "auth": {
                    "type": "password",
                    "password": "SECRET-SMTP-PASS"
                }
            },
            "auth": {
                "google": {
                    "clientId": "public-google-client-id",
                    "clientSecret": "SECRET-GOOGLE-CLIENT-SECRET"
                }
            },
            "permissions": {
                "guestAllowShare": false,
                "guestAllowJoin": true,
                "guestAllowRelay": true,
                "userRegister": false,
                "userRegisterRelay": true
            }
        }
    };
};

//
// what may not be in it
//
test("no key material, credential or database setting reaches the answer", () => {
    const answer = JSON.stringify(buildPublicConf(buildConf(), "0.0.4"));
    const secrets = [
        "SECRET-HTTP-KEY-PEM", "SECRET-HTTP-CERT-PEM",
        "SECRET-WS-KEY-PEM", "SECRET-WS-CERT-PEM",
        "SECRET-DB-USER", "SECRET-DB-PASS", "SECRET-DB-NAME", "db.example.com",
        "SECRET-SMTP-USER", "SECRET-SMTP-PASS", "smtp.example.com",
        "SECRET-GOOGLE-CLIENT-SECRET"
    ];
    for (const secret of secrets) {
        assert.equal(answer.includes(secret), false, secret + " reached the public configuration");
    }
});

test("the answer carries these sections and no others", () => {
    const answer = buildPublicConf(buildConf(), "0.0.4");
    assert.deepEqual(Object.keys(answer).sort(), ["auth", "pairing", "permissions", "version", "webrtc"]);
    assert.deepEqual(Object.keys(answer["webrtc"]), ["iceServers"]);
    assert.deepEqual(Object.keys(answer["auth"]["google"]), ["clientId"]);
});

test("the server-side permissions stay server-side", () => {
    // guestAllowRelay is answered: it is the fallback the client takes when the
    // two devices cannot reach each other, and a fallback that is not there must
    // not be waited for. What is still not answered is everything about *users* -
    // userRegister and userRegisterRelay decide what the server does, not what
    // this client may try.
    const answer = buildPublicConf(buildConf(), "0.0.4");
    assert.deepEqual(Object.keys(answer["permissions"]).sort(), ["guestAllowJoin", "guestAllowRelay", "guestAllowShare", "isAuth", "isGoogleAuth"]);
});

//
// what has to be in it
//
test("the answer opens with the version of the process answering", () => {
    assert.equal(buildPublicConf(buildConf(), "1.2.3")["version"], "1.2.3");
});

test("every guest permission is answered whether the configuration sets it or not", () => {
    // the client gates features on the answer rather than on a default of its
    // own, so a flag that is absent is an answer that has not arrived
    const conf = buildConf();
    delete conf["ws"]["permissions"];
    const answer = buildPublicConf(conf, "0.0.4");
    assert.deepEqual(answer["permissions"], {
        "guestAllowShare": true,
        "guestAllowJoin": true,
        // the one guest flag that is off unless it is asked for: it spends the
        // server's own bandwidth
        "guestAllowRelay": false,
        "isAuth": true,
        "isGoogleAuth": true
    });
});

test("a configured permission wins over the schema default", () => {
    const answer = buildPublicConf(buildConf(), "0.0.4")["permissions"];
    assert.equal(answer["guestAllowShare"], false);
    assert.equal(answer["guestAllowJoin"], true);
});

test("the pairing clock is the server's and is answered with it", () => {
    assert.deepEqual(buildPublicConf(buildConf(), "0.0.4")["pairing"], {"answerTimeout": ANSWER_TIMEOUT});
});

test("the ice servers are passed through as configured", () => {
    assert.deepEqual(buildPublicConf(buildConf(), "0.0.4")["webrtc"]["iceServers"], ["stun:stun.example.com:3478"]);
});

//
// the sign-in half
//
test("a server with no auth section says so and carries no auth block", () => {
    const conf = buildConf();
    delete conf["ws"]["auth"];
    delete conf["ws"]["email"];
    const answer = buildPublicConf(conf, "0.0.4");
    assert.equal("auth" in answer, false);
    assert.equal(answer["permissions"]["isAuth"], false);
    assert.equal(answer["permissions"]["isGoogleAuth"], false);
});

test("a configured Google provider is announced by its public client id alone", () => {
    const answer = buildPublicConf(buildConf(), "0.0.4");
    assert.equal(answer["permissions"]["isAuth"], true);
    assert.equal(answer["permissions"]["isGoogleAuth"], true);
    assert.deepEqual(answer["auth"], {"google": {"clientId": "public-google-client-id"}});
});

//
// the call
//
test("conf-get answers the object built at start, not a new one", () => {
    const confPublic = buildPublicConf(buildConf(), "0.0.4");
    const sent = [];
    confGet({
        "message": {},
        "messageObj": {"send": function(data) { sent.push(data); }},
        "sessionId": "session-1",
        "server": {"confPublic": confPublic}
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0], confPublic);
});
