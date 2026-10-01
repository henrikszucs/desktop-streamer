"use strict";

// the two configurations the client runs on: the server generated index.json
// it is served with, and the local one it keeps in IndexedDB

// third-party dependencies
import IDB from "../libs/idb/idb.js";

// first-party dependencies
import { DEFAULT_APPEARANCE } from "./appearance.js";

// the server generated file, never hand written
const conf = await (await fetch(new URL("../index.json", import.meta.url))).json();

const DATABASE = "desktop_streamer";
const CONF_TABLE = "configuration";
const USER_TABLE = "user";

// the table the guest used to have to itself, kept only to drop it
const OLD_GUEST_TABLE = "guest";

// local keys an older build kept, named only to drop them (the system holds auto launch)
const OLD_LOCAL_KEYS = ["autoLaunch"];

// the id of the guest: every user is a row of USER_TABLE under its own id, and
// a client is only ever one guest, so the empty key collides with no account
const GUEST_ID = "";

// the local keys and their fallbacks - the colour and theme are the server's, or
// the build's own defaults for an index.json written before it wrote them
const LOCAL_DEFAULTS = {
    "color": conf["appearance"]?.["color"] ?? DEFAULT_APPEARANCE["color"],
    "mode": conf["appearance"]?.["theme"] ?? DEFAULT_APPEARANCE["theme"],
    "lang": "auto",
    "minimizing": false,
    "exitShortcuts": "[]",
    // the accounts this client is signed in as - each with the session key
    // that signs it in again - and which of them it is, "" for the guest
    "accounts": "[]",
    "userId": ""
};

let DB = null;

// the users' rows while there is no database - storage blocked or broken: the
// client runs on the defaults, and nothing it stores outlives the page
const memoryUsers = new Map();

// the defaults as the local configuration, parsed the way a stored one is
const defaultLocal = function() {
    const result = {...LOCAL_DEFAULTS};
    result["exitShortcuts"] = JSON.parse(result["exitShortcuts"]);
    result["accounts"] = JSON.parse(result["accounts"]);
    return result;
};

// open the database and read the local configuration out of it
const openLocal = async function() {
    await IDB.TableSet(DATABASE, CONF_TABLE);
    await IDB.TableSet(DATABASE, USER_TABLE);

    // a client that ran the two-table build still carries the guest table -
    // dropping one that is not there is free, so this costs a version only once
    await IDB.TableDel(DATABASE, OLD_GUEST_TABLE);

    DB = await IDB.DatabaseGet(DATABASE);
    await IDB.RowDel(IDB.TableGet(DB, CONF_TABLE), OLD_LOCAL_KEYS);
    const table = IDB.TableGet(DB, CONF_TABLE);

    // load values from database
    const keys = Object.keys(LOCAL_DEFAULTS);
    const search = [];
    for (let key of keys) {
        search.push([key, LOCAL_DEFAULTS[key]]);
    }
    const res = await IDB.RowGet(table, search);
    const result = {};
    for (let i = 0, length = keys.length; i < length; i++) {
        result[keys[i]] = res[i];
    }

    // a stored value that does not parse is the default
    try {
        result["exitShortcuts"] = JSON.parse(result["exitShortcuts"]);
    } catch (error) {
        result["exitShortcuts"] = [];
    }
    if (Array.isArray(result["exitShortcuts"]) === false) {
        result["exitShortcuts"] = [];
    }
    try {
        result["accounts"] = JSON.parse(result["accounts"]);
    } catch (error) {
        result["accounts"] = [];
    }
    if (Array.isArray(result["accounts"]) === false) {
        result["accounts"] = [];
    }
    return result;
};

// a database that will not open is the defaults, never a boot that waits for ever
const confLoad = openLocal().catch(function(error) {
    console.error("Cannot open the local database, nothing will be kept:", error);
    DB = null;
    return defaultLocal();
});

// the IndexedDB table behind a name, only after confLoad resolved
const table = function(name) {
    return IDB.TableGet(DB, name);
};

// write one local value through to disk, conf["local"] is the copy in memory
const setLocal = async function(key, value, stored=value) {
    conf["local"][key] = value;
    if (DB === null) {
        return;
    }
    await IDB.RowSet(table(CONF_TABLE), [[key, stored]]);
};

// the keys that are who this client is rather than how it is set up: a reset
// of the settings leaves them alone, since signing out is its own action
const IDENTITY_KEYS = new Set(["accounts", "userId"]);

// every setting back to its default, on disk and in memory. Applying them -
// the theme, the language, the tray - is applyLocal() in ui/ui.js, the same
// call boot makes, so the caller runs that after this.
const resetLocal = async function() {
    const rows = [];
    for (const key of Object.keys(LOCAL_DEFAULTS)) {
        if (IDENTITY_KEYS.has(key) === true) {
            continue;
        }
        const stored = LOCAL_DEFAULTS[key];
        conf["local"][key] = (key === "exitShortcuts" ? JSON.parse(stored) : stored);
        rows.push([key, stored]);
    }
    if (DB === null) {
        return;
    }
    await IDB.RowSet(table(CONF_TABLE), rows);
};

// the records of one user, one row each and the guest under GUEST_ID - a user
// nothing was stored for reads back as an empty record rather than as a row.
// A copy either way, as a database read is, so a caller's changes are its own.
const getUser = async function(id=GUEST_ID) {
    if (DB === null) {
        return structuredClone(memoryUsers.get(id) ?? {});
    }
    const rows = await IDB.RowGet(table(USER_TABLE), [id]);
    return rows[0] ?? {};
};

const setUser = async function(id, data) {
    if (DB === null) {
        memoryUsers.set(id, structuredClone(data));
        return;
    }
    await IDB.RowSet(table(USER_TABLE), [[id, data]]);
};

// the joins one user holds, kept in that user record. The guest row holds the
// machine's shares beside the guest's own devices; an account row holds only
// that account's devices, which the server hands back at a sign-in on another
// client - src/management/joins.js is what decides the row a record goes in.
/*{
    <joinId>: {"joinCode", "isHost", "name", "isUnsupervised"}
}*/
const getJoins = async function(id=GUEST_ID) {
    const user = await getUser(id);
    return user["joins"] ?? {};
};

const setJoin = async function(joinId, record, id=GUEST_ID) {
    const user = await getUser(id);
    const joins = user["joins"] ?? {};
    joins[joinId] = {...joins[joinId], ...record};
    user["joins"] = joins;
    await setUser(id, user);
    return joins[joinId];
};

const removeJoin = async function(joinId, id=GUEST_ID) {
    const user = await getUser(id);
    if (typeof user["joins"] !== "object") {
        return;
    }
    delete user["joins"][joinId];
    await setUser(id, user);
};

// forget everything this client keeps for one user - the guest is no session, so
// this is its sign out; the local configuration is its own table and survives
const resetUser = async function(id=GUEST_ID) {
    if (DB === null) {
        memoryUsers.delete(id);
        return;
    }
    await IDB.RowDel(table(USER_TABLE), [id]);
};

export { conf, confLoad, table, setLocal, resetLocal, getUser, setUser, resetUser, getJoins, setJoin, removeJoin, GUEST_ID, DATABASE, CONF_TABLE, USER_TABLE };
export default { conf, confLoad, table, setLocal, resetLocal, getUser, setUser, resetUser, getJoins, setJoin, removeJoin, GUEST_ID, DATABASE, CONF_TABLE, USER_TABLE };
