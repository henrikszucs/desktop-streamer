"use strict";

// who a connection is, when it is somebody: the `users` row behind a Google
// sign-in, the `sessions` row a device keeps to come back without Google, and
// the calls that put a socket on one and take it off again.
//
// A connection is a guest until one of the two login calls answers, and a guest
// again after `login-guest` or `logout` - which are not the same thing: the
// first leaves the session row for the device to come back to, the second ends
// it, on this socket and on every other socket presenting the same key.
//
// Deleting the account is two calls a day apart at most: `delete-email` mails
// a key to the address on the row, `delete` takes it back and the row goes,
// with everything the foreign keys hang off it.

// first-party dependencies
import { generateId, httpsGetText, httpsGetImage } from "../../common.js";
import { notify } from "../notify.js";
import { addressOf } from "../address.js";
import { removeUserJoins, detachUserJoins } from "./joins.js";
import { setRelayAllowed } from "./rooms.js";

// how long a session stands without being presented; every login-session pushes
// it out again, so a device that comes back within the week never signs in twice
const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;

// how long a mailed delete key stands, and how soon another may be asked for
// from the same device - the button is one a person can press many times, and
// every press is a mail
const DELETE_LIFETIME = 24 * 60 * 60 * 1000;
const DELETE_COOLDOWN = 60 * 1000;

// the id and key searches give up rather than spinning, as the join codes do
const ID_ATTEMPTS = 100;

// the session key is the credential a device signs in again with and nobody
// ever types it, so it is long; the delete key is typed off a mail, and is
// only good for a day, on the session that asked for it
const SESSION_KEY_LENGTH = 32;
const ID_LENGTH = 10;

// a name is a label, and the field that writes one is capped at the same length
const NAME_MAX = 64;

// what a client says about the device it is, stored as it was sent - a JSON
// object of a few words, capped so that a row is not a document
const USER_AGENT_MAX = 256;

// where a Google credential is checked. It is Google's own endpoint, so the
// signature never has to be verified here - what has to be verified is that the
// token was minted for *this* client id, which the endpoint cannot know.
const GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo?id_token=";

//
// the providers, and the rules that decide who may sign in
//
// built once in start() from the configuration and kept on the server as
// `auth`, so a handler never sees the configuration itself and a test can put
// a verifier of its own in place of Google
const createAuth = function(conf) {
    const google = conf?.["ws"]?.["auth"]?.["google"];
    const permissions = conf?.["ws"]?.["permissions"] ?? {};

    const auth = {
        // whether an account this server has never seen may be made at sign-in,
        // and whether one made that way may use the relay - the two permissions
        // that stay server-side (see handlers/conf.js)
        "isRegisterAllowed": permissions["userRegister"] ?? true,
        "isRegisterRelayAllowed": permissions["userRegisterRelay"] ?? true,

        // a credential handed back by Google's button, checked with Google and
        // then against three things the endpoint cannot check for us: that it
        // was made for this client id - a token that verifies against another
        // one is somebody else's token - that the address behind it is verified,
        // and that it has not run out. Anything else is undefined, never a throw.
        "verifyGoogle": async function(credential) {
            return undefined;       // no provider configured
        }
    };

    if (typeof google?.["clientId"] === "string") {
        auth["verifyGoogle"] = async function(credential) {
            if (typeof credential !== "string" || credential === "") {
                return undefined;
            }
            try {
                const info = JSON.parse(await httpsGetText(GOOGLE_TOKENINFO + encodeURIComponent(credential)));
                if (info["aud"] !== google["clientId"]) {
                    throw new Error("the token was made for another client id");
                }
                if (info["email_verified"] !== "true" && info["email_verified"] !== true) {
                    throw new Error("the e-mail behind the token is not verified");
                }
                if (Number(info["exp"]) * 1000 < Date.now()) {
                    throw new Error("the token has expired");
                }
                if (typeof info["sub"] !== "string" || typeof info["email"] !== "string") {
                    throw new Error("the token names nobody");
                }
                return info;
            } catch (error) {
                console.log("Google sign-in refused:", error.message);
                return undefined;
            }
        };
    }
    return auth;
};

//
// the rows
//
// a value no row of the column holds, or undefined when the search gives up
const generateUnique = async function(db, table, column, length=ID_LENGTH) {
    for (let i = 0; i < ID_ATTEMPTS; i++) {
        const value = generateId(length);
        const taken = await db(table).where(column, value).first();
        if (typeof taken === "undefined") {
            return value;
        }
    }
    return undefined;
};

// a users row in the words the client reads: never the row itself. The relay
// flag is this server's decision and is checked here per message, but it is
// told, so a client can grey the fallback out rather than wait on one it has
// not got.
const profileOf = function(row, picture) {
    return {
        "userId": row["user_id"],
        "email": row["email"] ?? "",
        "firstName": row["first_name"] ?? "",
        "lastName": row["last_name"] ?? "",
        "picture": picture ?? "",
        "isRelayAllowed": isTrue(row["is_relay_allowed"])
    };
};

// SQLite has no boolean, so what comes back for one is a 0 or a 1
const isTrue = function(value) {
    return value === true || value === 1;
};

// the sessions row of one key, if it still stands. Rows that ran out are swept
// on the way, since a sign-in is the one moment the table is looked at anyway.
const findSession = async function(db, sessionKey) {
    if (typeof sessionKey !== "string" || sessionKey === "") {
        return undefined;
    }
    await db("sessions").where("expire", "<", Date.now()).del();
    return await db("sessions").where("session_key", sessionKey).first();
};

// what a credential says that a row does not. The names are the user's own
// once they were edited here, so only an empty one is filled in - which is
// also what makes a row seeded with an e-mail and nothing else a whole
// account the moment somebody signs in on it.
const fillFromGoogle = function(user, info) {
    const change = {};
    if ((user["first_name"] ?? "") === "" && typeof info["given_name"] === "string") {
        change["first_name"] = info["given_name"].substring(0, NAME_MAX);
    }
    if ((user["last_name"] ?? "") === "" && typeof info["family_name"] === "string") {
        change["last_name"] = info["family_name"].substring(0, NAME_MAX);
    }
    return change;
};

// The address a credential carries, onto the account it signed in. Google's
// `sub` is who a person is - it never changes and is never handed to anybody
// else - while the address is only the latest one Google verified for them,
// and it moves. So a row still holding this address belongs to somebody whose
// Google account has moved on from it: that user is signed out everywhere
// and left with no address (null, which a unique column holds any number
// of) until their own next sign-in brings the one Google has for them now.
// The two rows change together, so the address is never on both, or on none.
const takeEmail = async function(server, userId, email, exceptSessionId) {
    let previous = undefined;
    await server.db.transaction(async function(trx) {
        previous = await trx("users")
            .where("email", email)
            .whereNot("user_id", userId)
            .first();
        if (typeof previous !== "undefined") {
            await trx("users").where("user_id", previous["user_id"]).update({"email": null});
            await trx("sessions").where("user_id", previous["user_id"]).del();
        }
        await trx("users").where("user_id", userId).update({"email": email});
    });
    if (typeof previous !== "undefined") {
        console.log("The address of " + previous["user_id"] + " moved to " + userId + ", signed out");
        signOutUser(server, previous["user_id"], exceptSessionId);
    }
};

// the account behind a Google credential: the existing row, the row that was
// already waiting under that address, or a new one when the server allows
// that. Returns the users row, or the error name.
const findOrCreateGoogleUser = async function(server, info, sessionId) {
    const db = server.db;
    const link = await db("users_google").where("sub", info["sub"]).first();
    if (typeof link !== "undefined") {
        const user = await db("users").where("user_id", link["user_id"]).first();
        if (typeof user === "undefined") {
            return {"error": "unknown-user"};      // a link with no row behind it
        }

        // the person is the `sub`, and what Google says about them now is
        // what the row follows: the names it left empty, the address - the
        // latest verified one, wherever it was before - and the picture
        const change = fillFromGoogle(user, info);
        if (Object.keys(change).length > 0) {
            await db("users").where("user_id", user["user_id"]).update(change);
        }
        if (user["email"] !== info["email"]) {
            await takeEmail(server, user["user_id"], info["email"], sessionId);
            change["email"] = info["email"];
        }
        if ((link["picture"] ?? "") !== (info["picture"] ?? "")) {
            await db("users_google").where("sub", info["sub"]).update({"picture": info["picture"] ?? ""});
        }
        return {"user": {...user, ...change}, "pictureUrl": info["picture"] ?? ""};
    }

    // an address that is already a row is the person that row is for, as long
    // as nothing has claimed it yet: the credential is what proves them, and
    // the row is filled in rather than made. That is what a list of addresses
    // put in by hand is - an account each, waiting to be signed in on - and it
    // is how an organization opens a public domain to its own people alone,
    // with `userRegister` off so that nobody else is made a row by arriving.
    // Registering is not what happens here, so neither rule of it applies: the
    // relay permission answered is the one the row carries.
    const byEmail = await db("users").where("email", info["email"]).first();
    if (typeof byEmail !== "undefined") {
        // a row somebody is already signed in on is theirs, and a second
        // credential under the same address is a second account for one person
        const claimed = await db("users_google").where("user_id", byEmail["user_id"]).first();
        if (typeof claimed !== "undefined") {
            return {"error": "email-taken"};
        }
        const change = fillFromGoogle(byEmail, info);
        if (Object.keys(change).length > 0) {
            await db("users").where("user_id", byEmail["user_id"]).update(change);
        }
        await db("users_google").insert({
            "sub": info["sub"],
            "user_id": byEmail["user_id"],
            "picture": info["picture"] ?? ""
        });
        return {"user": {...byEmail, ...change}, "pictureUrl": info["picture"] ?? ""};
    }

    // nobody this server knows, under any address: only registering can make
    // one, and it is the permission that says whether it may
    if (server.auth["isRegisterAllowed"] !== true) {
        return {"error": "register-disabled"};
    }

    const userId = await generateUnique(db, "users", "user_id");
    if (userId === undefined) {
        return {"error": "failed"};
    }
    const user = {
        "user_id": userId,
        "email": info["email"],
        "first_name": (info["given_name"] ?? "").substring(0, NAME_MAX),
        "last_name": (info["family_name"] ?? "").substring(0, NAME_MAX),
        "is_relay_allowed": server.auth["isRegisterRelayAllowed"] === true,
        "created": Date.now()
    };
    await db("users").insert(user);
    await db("users_google").insert({
        "sub": info["sub"],
        "user_id": userId,
        "picture": info["picture"] ?? ""
    });
    return {"user": user, "pictureUrl": info["picture"] ?? ""};
};

// the picture as data rather than as Google's address: the client shows it in
// the bar of every screen, and a URL there would have the browser fetch from
// Google on every load, and fail quietly wherever Google is not reachable.
// Fetched once per account while it is online, and empty when it cannot be.
const loadPicture = async function(server, userId, pictureUrl) {
    const account = server.accounts.get(userId);
    if (typeof account?.["picture"] === "string" && account["pictureUrl"] === pictureUrl) {
        return account["picture"];
    }
    let picture = "";
    if (typeof pictureUrl === "string" && pictureUrl.startsWith("https://") === true) {
        try {
            picture = await httpsGetImage(pictureUrl);
        } catch (error) {
            console.log("Cannot load the picture of " + userId + ":", error.message);
        }
    }
    const held = server.accounts.get(userId);
    if (held !== undefined) {
        held["pictureUrl"] = pictureUrl;
        held["picture"] = picture;
    }
    return picture;
};

// the picture of an account, from the link row when it is not held in memory
const pictureOf = async function(server, userId) {
    const account = server.accounts.get(userId);
    if (typeof account?.["picture"] === "string") {
        return account["picture"];
    }
    const link = await server.db("users_google").where("user_id", userId).first();
    return await loadPicture(server, userId, link?.["picture"] ?? "");
};

//
// the accounts that are online
//
// `server.accounts` holds a user while at least one socket is signed in as
// them, and nothing longer: the row is what an account *is*, this is who can be
// told about it right now, and the picture so it is fetched once.
const attachAccount = function(server, sessionId, user, session) {
    const client = server.clients.get(sessionId);
    if (client === undefined) {
        return;         // the socket went while the row was being read
    }
    // a socket that was somebody else gives that account up first, and its
    // devices with it (detachAccount); the same person signing in again keeps
    // what this socket already holds of theirs
    if (client.get("userId") !== user["user_id"]) {
        detachAccount(server, sessionId);
    }

    let account = server.accounts.get(user["user_id"]);
    if (account === undefined) {
        /*{
            "sessionIds": Set,      (the connections signed in as this user)
            "pictureUrl": string,
            "picture": string       (a data URI, "" for none)
        }*/
        account = {"sessionIds": new Set(), "pictureUrl": undefined, "picture": undefined};
        server.accounts.set(user["user_id"], account);
    }
    account["sessionIds"].add(sessionId);

    // the connection is somebody now, and its relay permission is theirs - read
    // once, here, because the relay checks it per message (see rooms.js)
    client.set("userId", user["user_id"]);
    client.set("accountSessionId", session["session_id"]);
    setRelayAllowed(server, sessionId, isTrue(user["is_relay_allowed"]));
};

// the connection is a guest again. The row stays - ending it is logout's - and
// the guest permission comes back from the configuration.
const detachAccount = function(server, sessionId) {
    const client = server.clients.get(sessionId);
    const userId = client?.get("userId");
    if (typeof userId !== "string") {
        return;
    }
    // the account's devices are not this socket's once it is not the account,
    // nor the connections it made through them - a sign out, a recovery or a
    // deletion would otherwise leave a hijacked socket driving its devices
    detachUserJoins(server, sessionId, userId);
    client.delete("userId");
    client.delete("accountSessionId");
    setRelayAllowed(server, sessionId, server.confPublic?.["permissions"]?.["guestAllowRelay"] === true);

    const account = server.accounts.get(userId);
    if (account === undefined) {
        return;
    }
    account["sessionIds"].delete(sessionId);
    if (account["sessionIds"].size === 0) {
        server.accounts.delete(userId);
    }
};

// the whole table, for a server that is stopping
const releaseAccounts = function(server) {
    server.accounts.clear();
};

// every socket that is this user is a guest again, each told which of its
// sessions ended - except the one that asked, which is answered instead
const signOutUser = function(server, userId, exceptSessionId) {
    const account = server.accounts.get(userId);
    for (const otherId of [...(account?.["sessionIds"] ?? [])]) {
        const ended = server.clients.get(otherId)?.get("accountSessionId");
        detachAccount(server, otherId);
        if (otherId !== exceptSessionId) {
            notify(server, otherId, {"type": "logout", "sessionId": ended});
        }
    }
};

// the user a connection is, or undefined for a guest
const heldUser = function(server, sessionId) {
    const client = server.clients.get(sessionId);
    const userId = client?.get("userId");
    if (typeof userId !== "string") {
        return undefined;
    }
    return {"userId": userId, "accountSessionId": client.get("accountSessionId")};
};

// what the socket says about itself, kept small and kept as text
const userAgentOf = function(message) {
    const userAgent = message["userAgent"];
    if (typeof userAgent !== "object" || userAgent === null) {
        return "";
    }
    const text = JSON.stringify(userAgent);
    return text.length > USER_AGENT_MAX ? "" : text;
};

// a sessions row in the words the client reads - the key never among them,
// since the key is the credential and this list is shown on screen
const sessionOf = function(row, ownSessionId) {
    let userAgent = {};
    try {
        userAgent = JSON.parse(row["user_agent"] || "{}");
    } catch (error) {
        userAgent = {};
    }
    return {
        "sessionId": row["session_id"],
        "lastUsed": row["last_used"],
        "ipAddress": row["ip_address"] ?? "",
        "userAgent": userAgent,
        "isCurrent": row["session_id"] === ownSessionId
    };
};

//
// the calls
//
// a session of this user the caller already holds, if it names one that still
// stands: the key it sent along, or the one this connection is signed in on.
// Signing in again is then the same session and not a second row - a device
// that presses the button twice is one device, and one entry in the list.
const findOwnSession = async function(server, sessionId, userId, sessionKey) {
    const db = server.db;
    if (typeof sessionKey === "string" && sessionKey !== "") {
        const session = await findSession(db, sessionKey);
        if (typeof session !== "undefined" && session["user_id"] === userId) {
            return session;
        }
    }
    const held = heldUser(server, sessionId);
    if (held?.["userId"] === userId) {
        const session = await db("sessions")
            .where({"session_id": held["accountSessionId"], "user_id": userId})
            .andWhere("expire", ">", Date.now())
            .first();
        if (typeof session !== "undefined") {
            return session;
        }
    }
    return undefined;
};

// a Google credential becomes an account and a session on this socket. The
// session is what the client keeps: it is answered once, here, and presented
// through login-session from then on - and handed back rather than made again
// when the client already holds one for this user.
const loginGoogle = async function(ctx) {
    /*{
        "credential": string,
        "userAgent": {"os": string, ...},
        "sessionKey": string        (optional - a session the client holds for this user)
    }*/
    /*{
        "success": boolean,
        "sessionId": string,
        "sessionKey": string,
        "user": {"userId", "email", "firstName", "lastName", "picture"},
        "error": string
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];
    const messageObj = ctx["messageObj"];
    if (server.db === null || server.auth === null) {
        messageObj.send({"success": false, "error": "auth-disabled"});
        return;
    }

    const info = await server.auth["verifyGoogle"](ctx["message"]["credential"]);
    if (typeof info === "undefined") {
        messageObj.send({"success": false, "error": "invalid-credential"});
        return;
    }

    const found = await findOrCreateGoogleUser(server, info, sessionId);
    if (typeof found["user"] === "undefined") {
        messageObj.send({"success": false, "error": found["error"]});
        return;
    }
    const user = found["user"];
    const db = server.db;
    const now = Date.now();
    const change = {
        "expire": now + SESSION_LIFETIME,
        "last_used": now,
        "ip_address": addressOf(server, sessionId),
        "user_agent": userAgentOf(ctx["message"])
    };

    // the same person again: the session they have, pushed out and brought up
    // to date, is the one answered - unless it ended since it was found, in
    // which case the fresh credential starts a new one
    let session = await findOwnSession(server, sessionId, user["user_id"], ctx["message"]["sessionKey"]);
    if (typeof session !== "undefined") {
        const updated = await db("sessions").where("session_id", session["session_id"]).update(change);
        session = (updated === 0 ? undefined : {...session, ...change});
    }
    if (typeof session === "undefined") {
        const newSessionId = await generateUnique(db, "sessions", "session_id");
        const sessionKey = await generateUnique(db, "sessions", "session_key", SESSION_KEY_LENGTH);
        if (newSessionId === undefined || sessionKey === undefined) {
            messageObj.send({"success": false, "error": "failed"});
            return;
        }
        session = {
            "session_id": newSessionId,
            "user_id": user["user_id"],
            "session_key": sessionKey,
            ...change
        };
        await db("sessions").insert(session);
    }

    attachAccount(server, sessionId, user, session);
    const picture = await loadPicture(server, user["user_id"], found["pictureUrl"]);
    messageObj.send({
        "success": true,
        "sessionId": session["session_id"],
        "sessionKey": session["session_key"],
        "user": profileOf(user, picture)
    });
};

// a device that signed in before presents its key. The session is pushed out
// another week and the row learns where it was presented from.
const loginSession = async function(ctx) {
    /*{
        "sessionKey": string
    }*/
    /*{
        "success": boolean,
        "sessionId": string,
        "user": {"userId", "email", "firstName", "lastName", "picture"},
        "error": string
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];
    const messageObj = ctx["messageObj"];
    if (server.db === null) {
        messageObj.send({"success": false, "error": "auth-disabled"});
        return;
    }

    const db = server.db;
    const session = await findSession(db, ctx["message"]["sessionKey"]);
    if (typeof session === "undefined") {
        // gone, or run out: the client should forget the key
        messageObj.send({"success": false, "error": "unknown-session"});
        return;
    }
    const user = await db("users").where("user_id", session["user_id"]).first();
    if (typeof user === "undefined") {
        await db("sessions").where("session_id", session["session_id"]).del();
        messageObj.send({"success": false, "error": "unknown-session"});
        return;
    }

    // the row may have gone since it was read - a logout, a sessions-revoke or
    // the account deleted meanwhile - and whatever ended it has signed out
    // every socket it could see, which this one is not yet. The update is the
    // last wait before the socket is signed in, so it is the question asked.
    const updated = await db("sessions").where("session_id", session["session_id"]).update({
        "expire": Date.now() + SESSION_LIFETIME,
        "last_used": Date.now(),
        "ip_address": addressOf(server, sessionId)
    });
    if (updated === 0) {
        messageObj.send({"success": false, "error": "unknown-session"});
        return;
    }

    attachAccount(server, sessionId, user, session);
    const picture = await pictureOf(server, user["user_id"]);
    messageObj.send({
        "success": true,
        "sessionId": session["session_id"],
        "user": profileOf(user, picture)
    });
};

// this connection is the guest again, the session left standing for the
// device to come back to - what switching to the guest in the user menu calls
const loginGuest = function(ctx) {
    /*{
    }*/
    /*{
        "success": boolean
    }*/
    detachAccount(ctx["server"], ctx["sessionId"]);
    ctx["messageObj"].send({"success": true});
};

// a session ends: this connection's own, or another of the same user from the
// sessions window. Every socket on it is a guest again, and the ones that did
// not ask are told.
const logout = async function(ctx) {
    /*{
        "sessionId": string     (defaults to the caller's own)
    }*/
    /*{
        "success": boolean,
        "error": string
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];
    const messageObj = ctx["messageObj"];
    const held = heldUser(server, sessionId);
    if (held === undefined) {
        messageObj.send({"success": false, "error": "not-signed-in"});
        return;
    }

    let target = ctx["message"]["sessionId"];
    if (typeof target !== "string" || target === "") {
        target = held["accountSessionId"];
    }
    const deleted = await server.db("sessions")
        .where({"session_id": target, "user_id": held["userId"]})
        .del();
    if (deleted === 0) {
        messageObj.send({"success": false, "error": "unknown-session"});
        return;
    }

    // the sockets presenting that key, this one among them or not
    const account = server.accounts.get(held["userId"]);
    for (const otherId of [...(account?.["sessionIds"] ?? [])]) {
        if (server.clients.get(otherId)?.get("accountSessionId") !== target) {
            continue;
        }
        detachAccount(server, otherId);
        if (otherId !== sessionId) {
            notify(server, otherId, {"type": "logout", "sessionId": target});
        }
    }
    messageObj.send({"success": true});
};

// what the user calls themselves. The e-mail is Google's to say and stays as it
// is; the names are the user's, and every other socket of theirs is told.
const userUpdate = async function(ctx) {
    /*{
        "firstName": string,
        "lastName": string
    }*/
    /*{
        "success": boolean,
        "user": {"userId", "email", "firstName", "lastName", "picture"},
        "error": string
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];
    const messageObj = ctx["messageObj"];
    const held = heldUser(server, sessionId);
    if (held === undefined) {
        messageObj.send({"success": false, "error": "not-signed-in"});
        return;
    }

    const change = {};
    for (const [key, column] of [["firstName", "first_name"], ["lastName", "last_name"]]) {
        const value = ctx["message"][key];
        if (typeof value === "undefined") {
            continue;
        }
        if (typeof value !== "string" || value.length > NAME_MAX) {
            messageObj.send({"success": false, "error": "invalid-name"});
            return;
        }
        change[column] = value.trim();
    }
    if (Object.keys(change).length > 0) {
        await server.db("users").where("user_id", held["userId"]).update(change);
    }
    const user = await server.db("users").where("user_id", held["userId"]).first();
    if (typeof user === "undefined") {
        messageObj.send({"success": false, "error": "unknown-user"});
        return;
    }
    const profile = profileOf(user, await pictureOf(server, held["userId"]));
    messageObj.send({"success": true, "user": profile});

    for (const otherId of server.accounts.get(held["userId"])?.["sessionIds"] ?? []) {
        if (otherId !== sessionId) {
            notify(server, otherId, {"type": "user-change", "user": profile});
        }
    }
};

// the way back for a person locked out of their own account: a hijacked
// session that keeps ending every new one would win against logout, which
// only a signed-in socket may call. This one is called by nobody in particular
// - a guest, most likely - with a fresh credential, and ends every session of
// the account it names without starting one: whoever wants in again signs in
// again, on equal terms.
const sessionsRevoke = async function(ctx) {
    /*{
        "credential": string
    }*/
    /*{
        "success": boolean,
        "userId": string,
        "count": number,
        "error": string
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];
    const messageObj = ctx["messageObj"];
    if (server.db === null || server.auth === null) {
        messageObj.send({"success": false, "error": "auth-disabled"});
        return;
    }

    const info = await server.auth["verifyGoogle"](ctx["message"]["credential"]);
    if (typeof info === "undefined") {
        messageObj.send({"success": false, "error": "invalid-credential"});
        return;
    }

    // an account this server has never seen has no sessions to end, and this
    // is not the call that makes one
    const link = await server.db("users_google").where("sub", info["sub"]).first();
    if (typeof link === "undefined") {
        messageObj.send({"success": false, "error": "unknown-user"});
        return;
    }
    const userId = link["user_id"];
    const count = await server.db("sessions").where("user_id", userId).del();

    // every socket that was this person is a guest again - the caller among
    // them, if it was one, and answered rather than told
    signOutUser(server, userId, sessionId);
    messageObj.send({"success": true, "userId": userId, "count": count});
};

// every device signed in as this user, for the sessions window
const sessionList = async function(ctx) {
    /*{
    }*/
    /*{
        "success": boolean,
        "sessions": [{"sessionId", "lastUsed", "ipAddress", "userAgent", "isCurrent"}],
        "error": string
    }*/
    const server = ctx["server"];
    const held = heldUser(server, ctx["sessionId"]);
    if (held === undefined) {
        ctx["messageObj"].send({"success": false, "error": "not-signed-in"});
        return;
    }
    const rows = await server.db("sessions")
        .where("user_id", held["userId"])
        .andWhere("expire", ">", Date.now())
        .orderBy("last_used", "desc");
    ctx["messageObj"].send({
        "success": true,
        "sessions": rows.map(function(row) {
            return sessionOf(row, held["accountSessionId"]);
        })
    });
};

// the first half of deleting the account: a key is mailed to the address on
// the row, bound to the session that asked - so only the device that asked can
// present it back, and a key read off somebody else's screen opens nothing on
// another one. One code stands per account: asking again from the same device
// mails that same key again, for a mail that did not arrive, and asking from
// another device replaces it, so at no point are two codes good. Asking within
// the cooldown of the last mail is refused rather than mailed, since the
// button is one a person can press many times.
const deleteEmail = async function(ctx) {
    /*{
        "lang": string
    }*/
    /*{
        "success": boolean,
        "expire": number,
        "error": string
    }*/
    const server = ctx["server"];
    const messageObj = ctx["messageObj"];
    const held = heldUser(server, ctx["sessionId"]);
    if (held === undefined) {
        messageObj.send({"success": false, "error": "not-signed-in"});
        return;
    }
    if (server.mailer === null || typeof server.mailer === "undefined") {
        messageObj.send({"success": false, "error": "mail-disabled"});
        return;
    }
    const db = server.db;
    const user = await db("users").where("user_id", held["userId"]).first();
    if (typeof user === "undefined") {
        messageObj.send({"success": false, "error": "unknown-user"});
        return;
    }
    // an address that moved to another account (see takeEmail) is nowhere
    // to mail a key to until the next sign-in brings the current one
    if (typeof user["email"] !== "string" || user["email"] === "") {
        messageObj.send({"success": false, "error": "no-email"});
        return;
    }

    const now = Date.now();
    await db("delete").where("expire", "<", now).del();
    const pending = await db("delete").where("user_id", held["userId"]).first();
    if (typeof pending !== "undefined" && pending["created"] + DELETE_COOLDOWN > now) {
        messageObj.send({"success": false, "error": "too-soon"});
        return;
    }

    let request = pending;
    if (typeof pending !== "undefined" && pending["session_id"] === held["accountSessionId"]) {
        // the same key again; the cooldown counts from this mail
        await db("delete").where("delete_id", pending["delete_id"]).update({"created": now});
    } else {
        const deleteId = await generateUnique(db, "delete", "delete_id");
        const deleteKey = await generateUnique(db, "delete", "delete_key");
        if (deleteId === undefined || deleteKey === undefined) {
            messageObj.send({"success": false, "error": "failed"});
            return;
        }
        request = {
            "delete_id": deleteId,
            "user_id": held["userId"],
            "session_id": held["accountSessionId"],
            "delete_key": deleteKey,
            "expire": now + DELETE_LIFETIME,
            "created": now
        };
        await db("delete").where("user_id", held["userId"]).del();
        await db("delete").insert(request);
    }

    // a key that was not delivered is not a key: a new row goes with the
    // failure, and one that was mailed before stands as it did
    const lang = typeof ctx["message"]["lang"] === "string" ? ctx["message"]["lang"] : "";
    try {
        await server.mailer.sendDeleteKey(user["email"], lang, request["delete_key"]);
    } catch (error) {
        console.log("Cannot mail the delete key of " + held["userId"] + ":", error.message);
        if (request !== pending) {
            await db("delete").where("delete_id", request["delete_id"]).del();
        }
        messageObj.send({"success": false, "error": "mail-failed"});
        return;
    }
    messageObj.send({"success": true, "expire": request["expire"]});
};

// the second half: the key comes back on the device it was mailed for, and
// the account goes - the users row, and through its foreign keys the Google
// link, every session and the key itself. Every socket that was this person
// is a guest again and told so, the caller answered instead.
const deleteAccount = async function(ctx) {
    /*{
        "deleteKey": string
    }*/
    /*{
        "success": boolean,
        "error": string
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];
    const messageObj = ctx["messageObj"];
    const held = heldUser(server, sessionId);
    if (held === undefined) {
        messageObj.send({"success": false, "error": "not-signed-in"});
        return;
    }
    const deleteKey = ctx["message"]["deleteKey"];
    if (typeof deleteKey !== "string" || deleteKey.trim() === "") {
        messageObj.send({"success": false, "error": "invalid-key"});
        return;
    }

    // a key that ran out is swept rather than refused by its date, so that the
    // table never holds more than what could still be presented
    const db = server.db;
    await db("delete").where("expire", "<", Date.now()).del();
    const request = await db("delete").where({
        "delete_key": deleteKey.trim(),
        "user_id": held["userId"],
        "session_id": held["accountSessionId"]
    }).first();
    if (typeof request === "undefined") {
        messageObj.send({"success": false, "error": "invalid-key"});
        return;
    }
    // the devices go first, while the row still says whose they are: each
    // host is told, the way a join-delete would tell it
    await removeUserJoins(server, held["userId"]);
    await db("users").where("user_id", held["userId"]).del();

    signOutUser(server, held["userId"], sessionId);
    messageObj.send({"success": true});
};

// the types this group answers
const handlers = {
    "login-google": loginGoogle,
    "login-session": loginSession,
    "login-guest": loginGuest,
    "logout": logout,
    "user-update": userUpdate,
    "session-list": sessionList,
    "sessions-revoke": sessionsRevoke,
    "delete-email": deleteEmail,
    "delete": deleteAccount
};

export { handlers, createAuth, attachAccount, detachAccount, releaseAccounts, heldUser, profileOf, loginGoogle, loginSession, loginGuest, logout, userUpdate, sessionList, sessionsRevoke, deleteEmail, deleteAccount, SESSION_LIFETIME, SESSION_KEY_LENGTH, DELETE_LIFETIME, DELETE_COOLDOWN, NAME_MAX, USER_AGENT_MAX };
export default handlers;
