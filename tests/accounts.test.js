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
import { startDatabase, stopDatabase } from "../src/server/ws/database.js";
import { createAuth, detachAccount, heldUser, loginGoogle, loginSession, loginGuest, logout, userUpdate, sessionList, sessionsRevoke, NAME_MAX } from "../src/server/ws/handlers/accounts.js";

// an account is a row, so these run against a real SQLite file, the same way
// the joins tests do
const buildDatabase = async function() {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ds-accounts-")), "database.db");
    const db = await startDatabase({"ws": {"database": {"type": "sqlite", "host": file}}});
    return {"db": db, "file": file};
};

const dropDatabase = async function(db, file) {
    await stopDatabase(db);
    await fs.rm(path.dirname(file), {"recursive": true, "force": true});
};

const buildClient = function() {
    const pushed = [];
    return new Map([
        ["pushed", pushed],
        ["ws", {"_socket": {"remoteAddress": "127.0.0.1"}}],
        ["isRelayAllowed", false],
        ["com", {
            "send": function(message) {
                pushed.push(message);
                return {
                    "error": "",
                    "wait": async function() {
                        return this;
                    }
                };
            }
        }]
    ]);
};

// what Google would say about a person, in place of the tokeninfo endpoint:
// the verifier is the one thing that talks to Google, and it is swapped here
const GOOGLE_USERS = {
    "alice": {"sub": "sub-alice", "email": "alice@example.com", "given_name": "Alice", "family_name": "Liddell", "picture": ""},
    "bob": {"sub": "sub-bob", "email": "bob@example.com", "given_name": "Bob", "family_name": "", "picture": ""}
};

const buildServer = function(db, permissions = {}) {
    const clients = new Map();
    for (const sessionId of ["one", "two", "three"]) {
        clients.set(sessionId, buildClient());
    }
    const auth = createAuth({"ws": {"permissions": permissions, "auth": {"google": {"clientId": "id"}}}});
    auth["verifyGoogle"] = async function(credential) {
        return GOOGLE_USERS[credential];
    };
    return {
        "clients": clients,
        "accounts": new Map(),
        "db": db,
        "auth": auth,
        "confPublic": {"permissions": {"guestAllowRelay": false}}
    };
};

const buildCtx = function(server, sessionId, message = {}) {
    const answers = [];
    return {
        "message": message,
        "messageObj": {
            "send": function(data) {
                answers.push(data);
            }
        },
        "sessionId": sessionId,
        "server": server,
        "answers": answers
    };
};

const pushesOf = function(server, sessionId, type) {
    return server.clients.get(sessionId).get("pushed").filter(function(message) {
        return message["type"] === type;
    });
};

const signIn = async function(server, sessionId, who, sessionKey) {
    const message = {"credential": who, "userAgent": {"os": "darwin"}};
    if (typeof sessionKey !== "undefined") {
        message["sessionKey"] = sessionKey;
    }
    const ctx = buildCtx(server, sessionId, message);
    await loginGoogle(ctx);
    return ctx["answers"][0];
};

//
// the verifier
//
test("a server with no Google provider verifies nothing", async () => {
    const auth = createAuth({"ws": {"permissions": {}}});
    assert.equal(await auth["verifyGoogle"]("anything"), undefined);
    assert.equal(auth["isRegisterAllowed"], true);
    assert.equal(auth["isRegisterRelayAllowed"], true);
});

test("the register rules follow the configuration", () => {
    const auth = createAuth({"ws": {"permissions": {"userRegister": false, "userRegisterRelay": false}}});
    assert.equal(auth["isRegisterAllowed"], false);
    assert.equal(auth["isRegisterRelayAllowed"], false);
});

//
// signing in
//
test("login-google makes the account, the session and the signed-in connection", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const answer = await signIn(server, "one", "alice");
        assert.equal(answer["success"], true);
        assert.equal(typeof answer["sessionKey"], "string");
        assert.deepEqual(answer["user"], {
            "userId": answer["user"]["userId"],
            "email": "alice@example.com",
            "firstName": "Alice",
            "lastName": "Liddell",
            "picture": ""
        });

        const held = heldUser(server, "one");
        assert.equal(held["userId"], answer["user"]["userId"]);
        assert.equal(held["accountSessionId"], answer["sessionId"]);
        assert.equal(server.accounts.get(held["userId"])["sessionIds"].has("one"), true);

        const rows = await db("sessions").where("user_id", held["userId"]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0]["session_key"], answer["sessionKey"]);
        assert.equal(rows[0]["user_agent"], JSON.stringify({"os": "darwin"}));
    } finally {
        await dropDatabase(db, file);
    }
});

test("a refused credential makes nothing", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const answer = await signIn(server, "one", "nobody");
        assert.equal(answer["success"], false);
        assert.equal(answer["error"], "invalid-credential");
        assert.equal(heldUser(server, "one"), undefined);
        assert.equal((await db("users")).length, 0);
    } finally {
        await dropDatabase(db, file);
    }
});

test("the same person signing in again is the same account, on a second session", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const first = await signIn(server, "one", "alice");
        const second = await signIn(server, "two", "alice");
        assert.equal(first["user"]["userId"], second["user"]["userId"]);
        assert.notEqual(first["sessionId"], second["sessionId"]);
        assert.equal((await db("users")).length, 1);
        assert.equal((await db("sessions")).length, 2);
        assert.equal(server.accounts.get(first["user"]["userId"])["sessionIds"].size, 2);
    } finally {
        await dropDatabase(db, file);
    }
});

test("the same person again, with the key they hold, is the same session", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const first = await signIn(server, "one", "alice");
        const before = (await db("sessions").where("session_id", first["sessionId"]).first());
        await db("sessions").where("session_id", first["sessionId"]).update({"expire": before["expire"] - 1000, "last_used": before["last_used"] - 1000});

        // another socket of the same device presents the key it kept
        const again = await signIn(server, "two", "alice", first["sessionKey"]);
        assert.equal(again["success"], true);
        assert.equal(again["sessionId"], first["sessionId"]);
        assert.equal(again["sessionKey"], first["sessionKey"]);
        assert.equal((await db("sessions")).length, 1);
        assert.equal(heldUser(server, "two")["accountSessionId"], first["sessionId"]);

        // brought up to date rather than left as it was
        const row = await db("sessions").where("session_id", first["sessionId"]).first();
        assert.equal(row["expire"] >= before["expire"], true);
        assert.equal(row["last_used"] >= before["last_used"], true);
    } finally {
        await dropDatabase(db, file);
    }
});

test("a connection that is already this person keeps its session on a second sign-in", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const first = await signIn(server, "one", "alice");
        const again = await signIn(server, "one", "alice");
        assert.equal(again["sessionId"], first["sessionId"]);
        assert.equal((await db("sessions")).length, 1);
    } finally {
        await dropDatabase(db, file);
    }
});

test("a key of somebody else, or one that ran out, does not stand in for a session", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const bob = await signIn(server, "three", "bob");
        const withBobs = await signIn(server, "one", "alice", bob["sessionKey"]);
        assert.notEqual(withBobs["sessionId"], bob["sessionId"]);
        assert.equal(heldUser(server, "three")["accountSessionId"], bob["sessionId"]);

        await db("sessions").where("session_id", withBobs["sessionId"]).update({"expire": Date.now() - 1});
        const afterExpiry = await signIn(server, "two", "alice", withBobs["sessionKey"]);
        assert.equal(afterExpiry["success"], true);
        assert.notEqual(afterExpiry["sessionId"], withBobs["sessionId"]);
        assert.equal((await db("sessions").where("user_id", withBobs["user"]["userId"])).length, 1);
    } finally {
        await dropDatabase(db, file);
    }
});

test("an unknown account is refused when registering is off", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db, {"userRegister": false});
        const answer = await signIn(server, "one", "alice");
        assert.equal(answer["success"], false);
        assert.equal(answer["error"], "register-disabled");
    } finally {
        await dropDatabase(db, file);
    }
});

test("the relay permission of a new account is the register rule, and it reaches the connection", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db, {"userRegisterRelay": true});
        await signIn(server, "one", "alice");
        assert.equal(server.clients.get("one").get("isRelayAllowed"), true);

        // and the guest's comes back when the account goes
        detachAccount(server, "one");
        assert.equal(server.clients.get("one").get("isRelayAllowed"), false);
        assert.equal(heldUser(server, "one"), undefined);
        assert.equal(server.accounts.size, 0);
    } finally {
        await dropDatabase(db, file);
    }
});

//
// coming back
//
test("login-session signs the key's account in and pushes the expiry out", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const made = await signIn(server, "one", "alice");
        const before = (await db("sessions").where("session_id", made["sessionId"]).first())["expire"];
        await db("sessions").where("session_id", made["sessionId"]).update({"expire": before - 1000});

        const ctx = buildCtx(server, "two", {"sessionKey": made["sessionKey"]});
        await loginSession(ctx);
        assert.equal(ctx["answers"][0]["success"], true);
        assert.equal(ctx["answers"][0]["sessionId"], made["sessionId"]);
        assert.equal(ctx["answers"][0]["user"]["email"], "alice@example.com");
        assert.equal(heldUser(server, "two")["accountSessionId"], made["sessionId"]);

        const after = (await db("sessions").where("session_id", made["sessionId"]).first())["expire"];
        assert.equal(after >= before, true);
    } finally {
        await dropDatabase(db, file);
    }
});

test("a key nobody holds, or one that ran out, is unknown", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const made = await signIn(server, "one", "alice");
        await db("sessions").where("session_id", made["sessionId"]).update({"expire": Date.now() - 1});

        for (const sessionKey of ["no-such-key", made["sessionKey"], "", undefined]) {
            const ctx = buildCtx(server, "two", {"sessionKey": sessionKey});
            await loginSession(ctx);
            assert.equal(ctx["answers"][0]["success"], false);
            assert.equal(ctx["answers"][0]["error"], "unknown-session");
        }
        // the expired row was swept on the way
        assert.equal((await db("sessions")).length, 0);
    } finally {
        await dropDatabase(db, file);
    }
});

test("signing in on a connection that is somebody already replaces them without ending their session", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const alice = await signIn(server, "one", "alice");
        const bob = await signIn(server, "one", "bob");
        assert.equal(heldUser(server, "one")["userId"], bob["user"]["userId"]);
        assert.equal(server.accounts.has(alice["user"]["userId"]), false);
        assert.equal((await db("sessions")).length, 2);
    } finally {
        await dropDatabase(db, file);
    }
});

//
// signing out
//
test("login-guest takes the connection off the account and leaves the row", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const made = await signIn(server, "one", "alice");
        const ctx = buildCtx(server, "one");
        loginGuest(ctx);
        assert.equal(ctx["answers"][0]["success"], true);
        assert.equal(heldUser(server, "one"), undefined);
        assert.equal((await db("sessions").where("session_id", made["sessionId"])).length, 1);
    } finally {
        await dropDatabase(db, file);
    }
});

test("logout ends the caller's own session, on every socket presenting it", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const made = await signIn(server, "one", "alice");
        const other = buildCtx(server, "two", {"sessionKey": made["sessionKey"]});
        await loginSession(other);

        const ctx = buildCtx(server, "one");
        await logout(ctx);
        assert.equal(ctx["answers"][0]["success"], true);
        assert.equal(heldUser(server, "one"), undefined);
        assert.equal(heldUser(server, "two"), undefined);
        assert.equal((await db("sessions")).length, 0);

        // the one that did not ask is told, the caller is answered
        assert.equal(pushesOf(server, "one", "logout").length, 0);
        assert.equal(pushesOf(server, "two", "logout").length, 1);
        assert.equal(pushesOf(server, "two", "logout")[0]["sessionId"], made["sessionId"]);
    } finally {
        await dropDatabase(db, file);
    }
});

test("logout ends another session of the same user, and nobody else's", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const alice1 = await signIn(server, "one", "alice");
        const alice2 = await signIn(server, "two", "alice");
        const bob = await signIn(server, "three", "bob");

        const ctx = buildCtx(server, "one", {"sessionId": alice2["sessionId"]});
        await logout(ctx);
        assert.equal(ctx["answers"][0]["success"], true);
        assert.equal(heldUser(server, "one")["accountSessionId"], alice1["sessionId"]);
        assert.equal(heldUser(server, "two"), undefined);
        assert.equal(pushesOf(server, "two", "logout").length, 1);

        const refused = buildCtx(server, "one", {"sessionId": bob["sessionId"]});
        await logout(refused);
        assert.equal(refused["answers"][0]["success"], false);
        assert.equal(refused["answers"][0]["error"], "unknown-session");
        assert.equal(heldUser(server, "three")["accountSessionId"], bob["sessionId"]);
    } finally {
        await dropDatabase(db, file);
    }
});

test("a guest cannot sign out, update or list", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        for (const call of [logout, userUpdate, sessionList]) {
            const ctx = buildCtx(server, "one", {});
            await call(ctx);
            assert.equal(ctx["answers"][0]["success"], false);
            assert.equal(ctx["answers"][0]["error"], "not-signed-in");
        }
    } finally {
        await dropDatabase(db, file);
    }
});

//
// the profile
//
test("user-update writes the names, answers the profile and tells the other sockets", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const made = await signIn(server, "one", "alice");
        const other = buildCtx(server, "two", {"sessionKey": made["sessionKey"]});
        await loginSession(other);
        await signIn(server, "three", "bob");

        const ctx = buildCtx(server, "one", {"firstName": " Alicia ", "lastName": "L"});
        await userUpdate(ctx);
        assert.equal(ctx["answers"][0]["success"], true);
        assert.equal(ctx["answers"][0]["user"]["firstName"], "Alicia");
        assert.equal(ctx["answers"][0]["user"]["lastName"], "L");
        assert.equal(ctx["answers"][0]["user"]["email"], "alice@example.com");

        const row = await db("users").where("user_id", made["user"]["userId"]).first();
        assert.equal(row["first_name"], "Alicia");

        assert.equal(pushesOf(server, "one", "user-change").length, 0);
        assert.equal(pushesOf(server, "two", "user-change").length, 1);
        assert.equal(pushesOf(server, "two", "user-change")[0]["user"]["firstName"], "Alicia");
        assert.equal(pushesOf(server, "three", "user-change").length, 0);
    } finally {
        await dropDatabase(db, file);
    }
});

test("a name that is not one is refused whole", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        await signIn(server, "one", "alice");
        for (const message of [{"firstName": 5}, {"lastName": "x".repeat(NAME_MAX + 1)}, {"firstName": "ok", "lastName": null}]) {
            const ctx = buildCtx(server, "one", message);
            await userUpdate(ctx);
            assert.equal(ctx["answers"][0]["success"], false);
            assert.equal(ctx["answers"][0]["error"], "invalid-name");
        }
        const row = await db("users").first();
        assert.equal(row["first_name"], "Alice");
    } finally {
        await dropDatabase(db, file);
    }
});

test("a name the user gave is not overwritten by Google on the next sign-in", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        await signIn(server, "one", "alice");
        await userUpdate(buildCtx(server, "one", {"firstName": "Alicia"}));
        const again = await signIn(server, "two", "alice");
        assert.equal(again["user"]["firstName"], "Alicia");

        // an empty one is filled in, as it was the first time
        const bob = await signIn(server, "three", "bob");
        assert.equal(bob["user"]["lastName"], "");
        GOOGLE_USERS["bob"]["family_name"] = "Builder";
        const bobAgain = await signIn(server, "three", "bob");
        assert.equal(bobAgain["user"]["lastName"], "Builder");
        GOOGLE_USERS["bob"]["family_name"] = "";
    } finally {
        await dropDatabase(db, file);
    }
});

//
// the sessions
//
test("session-list answers every live session of the user, the caller's marked", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const first = await signIn(server, "one", "alice");
        const second = await signIn(server, "two", "alice");
        await signIn(server, "three", "bob");

        const ctx = buildCtx(server, "one");
        await sessionList(ctx);
        const answer = ctx["answers"][0];
        assert.equal(answer["success"], true);
        assert.equal(answer["sessions"].length, 2);
        const own = answer["sessions"].find(function(session) {
            return session["sessionId"] === first["sessionId"];
        });
        assert.equal(own["isCurrent"], true);
        assert.deepEqual(own["userAgent"], {"os": "darwin"});
        assert.equal(own["ipAddress"], "127.0.0.1");
        assert.equal(answer["sessions"].find(function(session) {
            return session["sessionId"] === second["sessionId"];
        })["isCurrent"], false);
        for (const session of answer["sessions"]) {
            assert.equal("sessionKey" in session, false, "the key is the credential and never listed");
        }
    } finally {
        await dropDatabase(db, file);
    }
});

//
// recovery
//
test("sessions-revoke ends every session of the account and starts none", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const alice1 = await signIn(server, "one", "alice");
        const alice2 = await signIn(server, "two", "alice");
        const bob = await signIn(server, "three", "bob");

        // a guest socket with a fresh credential - the caller is nobody
        const guest = buildClient();
        server.clients.set("four", guest);
        const ctx = buildCtx(server, "four", {"credential": "alice"});
        await sessionsRevoke(ctx);
        assert.equal(ctx["answers"][0]["success"], true);
        assert.equal(ctx["answers"][0]["userId"], alice1["user"]["userId"]);
        assert.equal(ctx["answers"][0]["count"], 2);

        assert.equal(heldUser(server, "four"), undefined, "nobody is signed in by it");
        assert.equal(heldUser(server, "one"), undefined);
        assert.equal(heldUser(server, "two"), undefined);
        assert.equal((await db("sessions").where("user_id", alice1["user"]["userId"])).length, 0);
        assert.equal(pushesOf(server, "one", "logout")[0]["sessionId"], alice1["sessionId"]);
        assert.equal(pushesOf(server, "two", "logout")[0]["sessionId"], alice2["sessionId"]);

        // and bob is untouched
        assert.equal(heldUser(server, "three")["accountSessionId"], bob["sessionId"]);
        assert.equal(pushesOf(server, "three", "logout").length, 0);

        // the keys open nothing any more
        const back = buildCtx(server, "one", {"sessionKey": alice1["sessionKey"]});
        await loginSession(back);
        assert.equal(back["answers"][0]["error"], "unknown-session");
    } finally {
        await dropDatabase(db, file);
    }
});

test("sessions-revoke by the account itself answers the caller rather than pushing to it", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        await signIn(server, "one", "alice");
        const ctx = buildCtx(server, "one", {"credential": "alice"});
        await sessionsRevoke(ctx);
        assert.equal(ctx["answers"][0]["count"], 1);
        assert.equal(heldUser(server, "one"), undefined);
        assert.equal(pushesOf(server, "one", "logout").length, 0);
    } finally {
        await dropDatabase(db, file);
    }
});

test("sessions-revoke refuses a bad credential and an account it has never seen, and makes neither", async () => {
    const {db, file} = await buildDatabase();
    try {
        const server = buildServer(db);
        const bad = buildCtx(server, "one", {"credential": "nobody"});
        await sessionsRevoke(bad);
        assert.equal(bad["answers"][0]["error"], "invalid-credential");

        const unknown = buildCtx(server, "one", {"credential": "alice"});
        await sessionsRevoke(unknown);
        assert.equal(unknown["answers"][0]["error"], "unknown-user");
        assert.equal((await db("users")).length, 0);
    } finally {
        await dropDatabase(db, file);
    }
});
