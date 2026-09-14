"use strict";

// the accounts this client is signed in as, and which of them it is right now.
//
// The client is always a user (see .claude/CLIENT.md): it starts as the guest,
// and an account signed in here is added beside it rather than in its place.
// What is kept is in the local configuration - each account with the session
// key that signs it in again, and the id of the one this client is - and the
// server is told who this socket is on every connection, since it holds that
// for the socket alone. Who the client *is* at any moment is `liveId`: the
// stored preference says who it wants to be, the server's answer says who it is.

// first-party dependencies
import { conf, setLocal, resetUser } from "../conf.js";
import { getPlatform } from "../env.js";

// the shell builds one of these and hands it to every module in ctx
const createAccount = function(ctx) {
    // the account the server has this socket signed in as, "" for the guest
    let liveId = "";

    // what changed here is drawn elsewhere - the bar, the account dialog, the
    // screens gated on who this client is - so they are told rather than polled
    const events = new EventTarget();
    const emitChange = function() {
        events.dispatchEvent(new CustomEvent("change"));
    };

    // the stored list, written back whole - it is a few records
    const stored = function() {
        return conf["local"]["accounts"];
    };
    const store = async function(accounts) {
        await setLocal("accounts", accounts, JSON.stringify(accounts));
    };

    // the record of one account, made from a login answer
    const recordOf = function(answer, sessionKey) {
        const user = answer["user"];
        return {
            "userId": user["userId"],
            "email": user["email"] ?? "",
            "firstName": user["firstName"] ?? "",
            "lastName": user["lastName"] ?? "",
            "picture": user["picture"] ?? "",
            "isRelayAllowed": user["isRelayAllowed"] === true,
            "sessionId": answer["sessionId"],
            "sessionKey": sessionKey
        };
    };

    // the list with one record put in, or replaced, by its id
    const putRecord = async function(record) {
        const accounts = stored().filter(function(account) {
            return account["userId"] !== record["userId"];
        });
        accounts.push(record);
        await store(accounts);
        return record;
    };

    // a profile the server answered or pushed, on the record it belongs to
    const mergeProfile = async function(user) {
        const record = account.get(user?.["userId"]);
        if (record === undefined) {
            return;
        }
        for (const key of ["email", "firstName", "lastName", "picture"]) {
            if (typeof user[key] === "string") {
                record[key] = user[key];
            }
        }
        // the relay permission is the server's to say and every profile says
        // it, so a record follows the newest answer
        if (typeof user["isRelayAllowed"] === "boolean") {
            record["isRelayAllowed"] = user["isRelayAllowed"];
        }
        await store(stored());
    };

    // an account this client no longer holds: the record goes, the devices it
    // kept here go with it (the server hands them back at the next sign-in, see
    // src/management/joins.js), and the client is the guest if it was that one
    const dropRecord = async function(userId) {
        await store(stored().filter(function(account) {
            return account["userId"] !== userId;
        }));
        await resetUser(userId);
        if (conf["local"]["userId"] === userId) {
            await setLocal("userId", "");
        }
        if (liveId === userId) {
            liveId = "";
        }
    };

    // the address a Google credential names, read off its payload. Nothing is
    // trusted from it - the server checks the credential - it is only used to
    // find which held account the person is signing in as again.
    const emailOfCredential = function(credential) {
        try {
            const payload = credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
            const email = JSON.parse(decodeURIComponent(atob(payload).split("").map(function(c) {
                return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
            }).join("")))["email"];
            return typeof email === "string" ? email.toLowerCase() : "";
        } catch (error) {
            return "";
        }
    };

    // the deletion this device asked for. It is a state of this window rather
    // than of the client: the key is only good on the session that asked and
    // asking again costs one click, so it lives in the tab's session storage -
    // it survives a reload here and reaches no other tab or device. Memory
    // stands in where the storage is not there.
    const DELETE_REQUEST = "deleteRequest";
    let heldDeleteRequest = null;
    const readDeleteRequest = function() {
        try {
            const text = sessionStorage.getItem(DELETE_REQUEST);
            return text === null ? null : JSON.parse(text);
        } catch (error) {
            return heldDeleteRequest;
        }
    };
    const writeDeleteRequest = function(request) {
        heldDeleteRequest = request;
        try {
            if (request === null) {
                sessionStorage.removeItem(DELETE_REQUEST);
            } else {
                sessionStorage.setItem(DELETE_REQUEST, JSON.stringify(request));
            }
        } catch (error) {
            // memory it is
        }
    };

    // the device this is, as the sessions window of another device shows it
    const userAgent = function() {
        const desktop = ctx["desktop"];
        return {
            "os": desktop?.["isAvailable"] === true ? desktop["os"].platform() : getPlatform(),
            "kind": desktop?.["isAvailable"] === true ? "desktop" : "web"
        };
    };

    const account = {
        // events: change
        "addEventListener": events.addEventListener.bind(events),
        "removeEventListener": events.removeEventListener.bind(events),

        // every account this client holds, the way it was last seen
        list() {
            return stored().map(function(record) {
                return {...record};
            });
        },

        get(userId) {
            return stored().find(function(record) {
                return record["userId"] === userId;
            });
        },

        // who this client is right now: "" and null for the guest
        currentId() {
            return liveId;
        },
        current() {
            return liveId === "" ? null : (account.get(liveId) ?? null);
        },
        isGuest() {
            return account.current() === null;
        },

        // the name an account is shown under, the address when it has none
        displayName(record) {
            const name = ((record["firstName"] ?? "") + " " + (record["lastName"] ?? "")).trim();
            return name !== "" ? name : (record["email"] ?? "");
        },

        // a credential from Google's button: the server makes the account and
        // the session, and this client is that account from here on. Signing
        // in again as an account this client already holds sends the session
        // it has along, so the server hands that one back rather than making
        // a second - one device, one entry in the sessions list.
        async loginGoogle(credential) {
            const email = emailOfCredential(credential);
            const held = stored().find(function(record) {
                return email !== "" && (record["email"] ?? "").toLowerCase() === email;
            });
            const answer = await ctx["server"].loginGoogle(credential, userAgent(), held?.["sessionKey"]);
            const record = await putRecord(recordOf(answer, answer["sessionKey"]));
            liveId = record["userId"];
            await setLocal("userId", liveId);
            emitChange();
            return record;
        },

        // the account this client wants to be, presented again on a fresh
        // socket. Called on every online, before the route is drawn, so what
        // is drawn is drawn as the right user. A key the server no longer
        // knows is dropped: the session was ended elsewhere or ran out.
        async resume() {
            const wanted = conf["local"]["userId"];
            const record = account.get(wanted);
            if (wanted === "" || record === undefined) {
                if (liveId !== "") {
                    liveId = "";
                    emitChange();
                }
                return;
            }
            try {
                const answer = await ctx["server"].loginSession(record["sessionKey"]);
                record["sessionId"] = answer["sessionId"];
                await mergeProfile(answer["user"]);
                liveId = record["userId"];
            } catch (error) {
                if (error.message === "unknown-session") {
                    await dropRecord(record["userId"]);
                } else {
                    console.error("Cannot resume the session of " + record["userId"] + ":", error);
                    liveId = "";
                }
            }
            emitChange();
        },

        // one of the held accounts, or the guest for "": who this client is
        // from now on, remembered for the next start
        async switchTo(userId) {
            if (userId === liveId) {
                return;
            }
            if (userId === "") {
                await ctx["server"].loginGuest();
                liveId = "";
                await setLocal("userId", "");
                emitChange();
                return;
            }
            const record = account.get(userId);
            if (record === undefined) {
                throw new Error("unknown-account");
            }
            try {
                const answer = await ctx["server"].loginSession(record["sessionKey"]);
                record["sessionId"] = answer["sessionId"];
                await mergeProfile(answer["user"]);
                liveId = userId;
                await setLocal("userId", userId);
            } catch (error) {
                if (error.message === "unknown-session") {
                    await dropRecord(userId);
                }
                emitChange();
                throw error;
            }
            emitChange();
        },

        // the current account's session ends - on the server, on every socket
        // presenting it - and the record goes with it
        async logout() {
            const record = account.current();
            if (record === null) {
                return;
            }
            try {
                await ctx["server"].logout();
            } catch (error) {
                // a session the server already lost is signed out either way
                if (error.message !== "unknown-session" && error.message !== "not-signed-in") {
                    throw error;
                }
            }
            await dropRecord(record["userId"]);
            emitChange();
        },

        // the names of the current account, written on the server and here
        async update(firstName, lastName) {
            const user = await ctx["server"].userUpdate(firstName, lastName);
            await mergeProfile(user);
            emitChange();
            return account.current();
        },

        // every device signed in as the current account
        async sessions() {
            return await ctx["server"].sessionList();
        },

        // another device of the current account is signed out
        async endSession(sessionId) {
            await ctx["server"].logout(sessionId);
        },

        // every session of the account a credential names is ended, this
        // client's own among them if it held one - and none is started, so
        // whoever wants back in signs in again. Answers how many went and
        // whether this client was that account a moment ago.
        async recover(credential) {
            const answer = await ctx["server"].sessionsRevoke(credential);
            const wasLive = (liveId === answer["userId"]);
            await dropRecord(answer["userId"]);
            emitChange();
            return {"count": answer["count"] ?? 0, "wasLive": wasLive};
        },

        // the first half of deleting the current account: the server mails a
        // key to its address, and this device is noted as the one that asked
        async requestDelete() {
            const record = account.current();
            if (record === null) {
                throw new Error("not-signed-in");
            }
            const answer = await ctx["server"].deleteEmail(ctx["localization"].getLang());
            writeDeleteRequest({
                "userId": record["userId"],
                "sessionId": record["sessionId"],
                "expire": answer["expire"] ?? 0
            });
        },

        // whether a key this device asked for is still worth presenting: the
        // request is for the account this client is right now, on the session
        // it is signed in on, and has not run out
        hasDeleteRequest() {
            const record = account.current();
            const request = readDeleteRequest();
            return record !== null && request !== null
                && request["userId"] === record["userId"]
                && request["sessionId"] === record["sessionId"]
                && request["expire"] > Date.now();
        },

        // the second half: the key back, and the account is gone - on the
        // server with every session it had, here with its record
        async deleteAccount(deleteKey) {
            const record = account.current();
            if (record === null) {
                throw new Error("not-signed-in");
            }
            await ctx["server"].deleteAccount(deleteKey);
            writeDeleteRequest(null);
            await dropRecord(record["userId"]);
            emitChange();
        }
    };

    // the profile changed on another device of the same account
    ctx["server"].addEventListener("user-change", async function(event) {
        await mergeProfile(event.detail?.["user"]);
        emitChange();
    });

    // this device's session was ended from another one: the client is the guest
    // again, and the route is drawn again under the dialogs that go, as a sign
    // out from here would
    ctx["server"].addEventListener("logout", async function(event) {
        const record = account.current();
        if (record === null || record["sessionId"] !== event.detail?.["sessionId"]) {
            return;
        }
        await dropRecord(record["userId"]);
        emitChange();
        ctx["ui"]?.closeDialogs();
        await ctx["ui"]?.reload();
    });

    // an offline socket changes nothing here: the loading layer covers the
    // screen until the next one, and resume() on it is what says who the client
    // is again - so the bar does not flip to the guest and back on a reconnect

    return account;
};

export { createAccount };
export default createAccount;
