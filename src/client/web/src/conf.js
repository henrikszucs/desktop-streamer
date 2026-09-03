"use strict";

// the two configurations the client runs on: the server generated index.json
// it is served with, and the local one it keeps in IndexedDB

// third-party dependencies
import IDB from "../libs/idb/idb.js";

// the server generated file, never hand written
const conf = await (await fetch(new URL("../index.json", import.meta.url))).json();

const DATABASE = "desktop_streamer";
const CONF_TABLE = "configuration";
const USER_TABLE = "user";

// the table the guest used to have to itself, kept only to drop it: everything
// it held is a row of USER_TABLE now
const OLD_GUEST_TABLE = "guest";

// the id of the guest
//
// Every user this client keeps records for is one row of USER_TABLE under the
// id of the user it belongs to - the guest included, which is what the empty
// id is: a user with no account behind it rather than a table of its own. A
// client is only ever one guest, so the empty key is that guest's row and
// collides with no account id.
const GUEST_ID = "";

// the local keys and the value each falls back to
const LOCAL_DEFAULTS = {
    "color": "#006e1c",
    "mode": "auto",
    "lang": "auto",
    "autoLaunch": false,
    "minimizing": false,
    "exitShortcuts": "[]",
    "sessionId": "",
    "sessionKey": ""
};

let DB = null;

// open the database and read the local configuration out of it
const confLoad = new Promise(async function(resolve) {
    await IDB.TableSet(DATABASE, CONF_TABLE);
    await IDB.TableSet(DATABASE, USER_TABLE);

    // a client that ran the two-table build still carries the guest table, and
    // it is a row of the user one now. Dropping a table that is not there is
    // nothing, so this costs a database version only the once.
    await IDB.TableDel(DATABASE, OLD_GUEST_TABLE);

    DB = await IDB.DatabaseGet(DATABASE);
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

    result["exitShortcuts"] = JSON.parse(result["exitShortcuts"]);
    resolve(result);
});

// the IndexedDB table behind a name, only after confLoad resolved
const table = function(name) {
    return IDB.TableGet(DB, name);
};

// write one local value through to disk, conf["local"] is the copy in memory
const setLocal = async function(key, value, stored=value) {
    conf["local"][key] = value;
    await IDB.RowSet(table(CONF_TABLE), [[key, stored]]);
};

// the records of one user: everything this client keeps for whoever it is
// signed in as - the connections it can reach, and whatever is stored beside
// them later. One row per user, the guest under GUEST_ID, and a user nothing
// was ever stored for reads back as an empty record rather than as a row.
const getUser = async function(id=GUEST_ID) {
    const rows = await IDB.RowGet(table(USER_TABLE), [id]);
    return rows[0] ?? {};
};

const setUser = async function(id, data) {
    await IDB.RowSet(table(USER_TABLE), [[id, data]]);
};

// forget everything this client keeps for one user
//
// For the guest this is the reset the user menu offers where an account would
// be signed out: the guest is not a session, so there is nothing to end on the
// server, only the records here. The local configuration is a table of its own
// and no user's row, so the theme and the language survive it.
const resetUser = async function(id=GUEST_ID) {
    await IDB.RowDel(table(USER_TABLE), [id]);
};

export { conf, confLoad, table, setLocal, getUser, setUser, resetUser, GUEST_ID, DATABASE, CONF_TABLE, USER_TABLE };
export default { conf, confLoad, table, setLocal, getUser, setUser, resetUser, GUEST_ID, DATABASE, CONF_TABLE, USER_TABLE };
