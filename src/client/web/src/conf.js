"use strict";

// the two configurations the client runs on: the server generated index.json
// it is served with, and the local one it keeps in IndexedDB

// third-party dependencies
import IDB from "../libs/idb/idb.js";

// the server generated file, never hand written
const conf = await (await fetch(new URL("../index.json", import.meta.url))).json();

const DATABASE = "desktop_streamer";
const CONF_TABLE = "configuration";
const GUEST_TABLE = "guest";
const USER_TABLE = "user";

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
    await IDB.TableSet(DATABASE, GUEST_TABLE);
    await IDB.TableSet(DATABASE, USER_TABLE);

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

export { conf, confLoad, table, setLocal, DATABASE, CONF_TABLE, GUEST_TABLE, USER_TABLE };
export default { conf, confLoad, table, setLocal, DATABASE, CONF_TABLE, GUEST_TABLE, USER_TABLE };
