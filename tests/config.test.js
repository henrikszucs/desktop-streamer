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
import { checkConfig, loadConfig } from "../src/server/config.js";

const repoPath = path.resolve(import.meta.dirname, "..");

const KEY_CONTENTS = "-----BEGIN TEST KEY-----";
const CERT_CONTENTS = "-----BEGIN TEST CERT-----";

// a configuration folder holding the config file and the certificates it names
const writeConf = async function(t, config, {withCerts = true} = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds-conf-"));
    t.after(async () => {
        await fs.rm(dir, {"recursive": true, "force": true});
    });
    if (withCerts === true) {
        await fs.writeFile(path.join(dir, "server.key"), KEY_CONTENTS);
        await fs.writeFile(path.join(dir, "server.crt"), CERT_CONTENTS);
    }
    const confPath = path.join(dir, "config.json");
    await fs.writeFile(confPath, typeof config === "string" ? config : JSON.stringify(config));
    return {"dir": dir, "path": confPath};
};

const httpSection = function() {
    return {
        "domain": "localhost",
        "port": 8443,
        "key": "server.key",
        "cert": "server.crt"
    };
};

const wsSection = function() {
    return {
        "domain": "localhost",
        "port": 8444,
        "key": "server.key",
        "cert": "server.crt",
        "database": {
            "type": "sqlite",
            "file": "database.db"
        },
        "webrtc": {
            "iceServers": ["stun:stun.l.google.com:19302"]
        },
        "permissions": {
            "guestAllowShare": true,
            "guestAllowJoin": true,
            "guestAllowRelay": false,
            "userRegisterRelay": true
        }
    };
};

const mysqlDatabase = function() {
    return {
        "type": "mysql",
        "host": "localhost",
        "port": 3306,
        "user": "root",
        "pass": "root",
        "db": "desktop_streamer"
    };
};

// loadConfig rejects with a message, this returns it (and "" when it accepts,
// so the assertion on the message fails the test)
const loadError = async function(t, config, options) {
    const conf = await writeConf(t, config, options);
    return await loadConfig(conf["path"]).then(
        function() {
            return "";
        },
        function(error) {
            return error.message;
        }
    );
};

//
// The shipped example
//
test("the shipped example configuration passes the schema", async () => {
    // the certificates it names are not in the repo, so only the schema is checked
    const contents = await fs.readFile(path.join(repoPath, "conf", "config.example.json"), "utf8");
    const result = checkConfig(JSON.parse(contents));
    assert.deepEqual(result["errors"], []);
    assert.equal(result["valid"], true);
});

//
// Accepted configurations
//
test("loadConfig accepts an http and ws pair and reads the certificates", async (t) => {
    const conf = await writeConf(t, {"http": httpSection(), "ws": wsSection()});
    const config = await loadConfig(conf["path"]);

    // the servers need the contents, the file holds only the paths
    assert.equal(config["http"]["key"], KEY_CONTENTS);
    assert.equal(config["http"]["cert"], CERT_CONTENTS);
    assert.equal(config["ws"]["key"], KEY_CONTENTS);
    assert.equal(config["ws"]["cert"], CERT_CONTENTS);
});

test("loadConfig resolves the sqlite file against the configuration folder", async (t) => {
    const conf = await writeConf(t, {"http": httpSection(), "ws": wsSection()});
    const config = await loadConfig(conf["path"]);
    assert.equal(config["ws"]["database"]["file"], path.resolve(conf["dir"], "database.db"));
});

test("loadConfig accepts a mysql database", async (t) => {
    const ws = wsSection();
    ws["database"] = mysqlDatabase();
    const conf = await writeConf(t, {"http": httpSection(), "ws": ws});
    const config = await loadConfig(conf["path"]);
    assert.equal(config["ws"]["database"]["type"], "mysql");
});

test("loadConfig accepts a ws section on its own", async (t) => {
    const conf = await writeConf(t, {"ws": wsSection()});
    const config = await loadConfig(conf["path"]);
    assert.equal(config["ws"]["port"], 8444);
});

test("loadConfig accepts an http section pointed at a remote ws server", async (t) => {
    const http = httpSection();
    http["remote"] = {"host": "ws.example.com", "port": 444};
    const conf = await writeConf(t, {"http": http});
    const config = await loadConfig(conf["path"]);
    assert.equal(config["http"]["remote"]["port"], 444);
});

//
// Rejected configurations
//
test("loadConfig rejects a file it cannot read", async () => {
    await assert.rejects(
        loadConfig(path.join(os.tmpdir(), "ds-missing-config.json")),
        /Cannot read configuration file/
    );
});

test("loadConfig rejects malformed JSON and a non-object root", async (t) => {
    assert.match(await loadError(t, "{ not json"), /Invalid configuration file/);
    assert.match(await loadError(t, "[]"), /root element must be an object/);
});

test("loadConfig rejects a configuration with neither http nor ws", async (t) => {
    assert.match(await loadError(t, {}), /Invalid configuration file/);
});

test("loadConfig rejects a missing required field", async (t) => {
    const http = httpSection();
    delete http["cert"];
    assert.match(await loadError(t, {"http": http, "ws": wsSection()}), /required property 'cert'/);
});

test("loadConfig rejects an unknown field", async (t) => {
    const http = httpSection();
    http["unknown"] = true;
    assert.match(await loadError(t, {"http": http, "ws": wsSection()}), /additional properties/);
});

test("loadConfig rejects a port outside the valid range", async (t) => {
    const http = httpSection();
    http["port"] = 70000;
    assert.match(await loadError(t, {"http": http, "ws": wsSection()}), /must be <= 65535/);
});

test("loadConfig rejects a database mixing the mysql and sqlite branches", async (t) => {
    const ws = wsSection();

    // sqlite fields on a mysql database
    ws["database"] = Object.assign(mysqlDatabase(), {"file": "database.db"});
    assert.match(await loadError(t, {"ws": ws}), /oneOf|additional properties/);

    // a mysql host on a sqlite database, the shape the example file used to have
    ws["database"] = {"type": "sqlite", "host": "database.db", "db": "desktop_streamer"};
    assert.match(await loadError(t, {"ws": ws}), /oneOf|additional properties|required property 'file'/);

    // a database type that does not exist
    ws["database"] = {"type": "sqlite3", "file": "database.db"};
    assert.match(await loadError(t, {"ws": ws}), /oneOf|equal to constant/);
});

test("loadConfig rejects email and auth unless both are set", async (t) => {
    const email = {
        "host": "mail.example.com",
        "port": 567,
        "user": "user@example.com",
        "auth": {"type": "password", "password": "12345678"}
    };
    const auth = {"google": {"clientId": "1234567890", "clientSecret": "12345678"}};

    const withEmail = wsSection();
    withEmail["email"] = email;
    assert.match(await loadError(t, {"ws": withEmail}), /auth/);

    const withAuth = wsSection();
    withAuth["auth"] = auth;
    assert.match(await loadError(t, {"ws": withAuth}), /email/);

    // together they are accepted
    const withBoth = wsSection();
    withBoth["email"] = email;
    withBoth["auth"] = auth;
    const conf = await writeConf(t, {"ws": withBoth});
    const config = await loadConfig(conf["path"]);
    assert.equal(config["ws"]["auth"]["google"]["clientId"], "1234567890");
});

//
// Constraints the schema cannot express
//
test("loadConfig rejects an http port colliding with its redirect port", async (t) => {
    const http = httpSection();
    http["redirect"] = http["port"];
    assert.match(await loadError(t, {"http": http, "ws": wsSection()}), /cannot be the same as/);
});

test("loadConfig lets the ws server share the https port", async (t) => {
    const http = httpSection();
    const ws = wsSection();
    ws["port"] = http["port"];      // the WS server only adds the upgrade to it
    const conf = await writeConf(t, {"http": http, "ws": ws});
    const config = await loadConfig(conf["path"]);
    assert.equal(config["ws"]["port"], config["http"]["port"]);
});

test("loadConfig rejects a ws port colliding with the redirect port", async (t) => {
    const http = httpSection();
    http["redirect"] = 8080;
    const ws = wsSection();
    ws["port"] = 8080;
    assert.match(await loadError(t, {"http": http, "ws": ws}), /cannot be the same as/);
});

test("loadConfig rejects an http section with no ws server to talk to", async (t) => {
    assert.match(await loadError(t, {"http": httpSection()}), /HTTP remote configuration must be provided/);
});

test("loadConfig rejects a local ws server beside an http remote", async (t) => {
    const http = httpSection();
    http["remote"] = {"host": "ws.example.com", "port": 444};
    assert.match(
        await loadError(t, {"http": http, "ws": wsSection()}),
        /WS server cannot be created if HTTP remote is configured/
    );
});

test("loadConfig rejects a certificate file it cannot read", async (t) => {
    const message = await loadError(t, {"ws": wsSection()}, {"withCerts": false});
    assert.match(message, /Cannot read WS key file/);
});
