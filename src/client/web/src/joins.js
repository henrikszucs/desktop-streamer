"use strict";

// the remembered devices this client holds, on both sides of them: the records
// in the local database, the codes they are reached with, and who is online.
//
// A join has no account behind it - the code *is* the credential (see
// .claude/CLIENT.md) - so this file is the whole of what makes a device come
// back: what is not stored here is a device this client has lost.

// first-party dependencies
import { getJoins, setJoin, removeJoin } from "./conf.js";

// the shell builds one of these and hands it to every module in ctx
const createJoins = function(ctx) {
    // joinId -> {joinCode, isHost, name, isUnsupervised, isOnline}
    const records = new Map();

    // what changed here is drawn elsewhere - the shares badge of the two bars is
    // not a screen anybody opened, so it is told rather than left to ask
    const events = new EventTarget();
    const emitChange = function() {
        events.dispatchEvent(new CustomEvent("change"));
    };

    const joins = {
        "records": records,

        // events: change
        "addEventListener": events.addEventListener.bind(events),
        "removeEventListener": events.removeEventListener.bind(events),

        // how many of the devices on one side of this client are there right
        // now. Presence is pushed, so this is an answer rather than an age.
        countOnline(isHost) {
            let count = 0;
            for (const record of records.values()) {
                if (record["isHost"] === isHost && record["isOnline"] === true) {
                    count++;
                }
            }
            return count;
        },

        // what the two screens list. The records are local; only who is online
        // comes from the server, and only when somebody is looking.
        async list(isHost) {
            const stored = await getJoins();
            for (const [joinId, record] of Object.entries(stored)) {
                records.set(joinId, {...records.get(joinId), ...record, "joinId": joinId});
            }

            // a join this client holds but the server does not know is gone -
            // dropped by the other side while this one was away
            if (ctx["server"].isOnline === true) {
                const live = await ctx["server"].joinList();
                const online = new Map(live.map(function(entry) {
                    return [entry["joinId"], entry];
                }));
                for (const [joinId, record] of records) {
                    const entry = online.get(joinId);
                    record["isOnline"] = (entry?.["isOnline"] === true);
                    if (typeof entry?.["isUnsupervised"] === "boolean") {
                        record["isUnsupervised"] = entry["isUnsupervised"];
                    }
                }
            }

            emitChange();
            return [...records.values()].filter(function(record) {
                return record["isHost"] === isHost;
            });
        },

        // every code this client holds, presented at once. Until this has run
        // the server does not know this device is on any of its joins, so a
        // host that has just started is not reachable by anybody it remembers.
        async connectAll() {
            const stored = await getJoins();
            for (const [joinId, record] of Object.entries(stored)) {
                records.set(joinId, {...records.get(joinId), ...record, "joinId": joinId});
                try {
                    const answer = await ctx["server"].joinConnect(record["joinCode"]);
                    const merged = {
                        ...records.get(joinId),
                        "isHost": answer["isHost"],
                        "isUnsupervised": answer["isUnsupervised"],
                        "isOnline": answer["isOnline"]
                    };

                    // the name is on the row too, so this is where a device that
                    // named the connection elsewhere gets it back. An empty one
                    // is a row nobody named, not a name somebody cleared.
                    if (typeof answer["name"] === "string" && answer["name"] !== "") {
                        merged["name"] = answer["name"];
                        if (record["name"] !== answer["name"]) {
                            await setJoin(joinId, {"name": answer["name"]});
                        }
                    }
                    records.set(joinId, merged);
                } catch (error) {
                    // the row is gone: the other side forgot this device, and a
                    // code that opens nothing is worth keeping no longer
                    if (error.message === "unknown-join") {
                        await joins.forget(joinId);
                        continue;
                    }
                    console.error("Cannot connect join " + joinId + ":", error);
                }
            }
            emitChange();
        },

        // what a pair-accept hands back, on either side of it
        async remember(detail, isHost) {
            if (detail?.["isRemember"] !== true || typeof detail["joinId"] !== "string") {
                return undefined;
            }
            const record = {
                "joinCode": detail["joinCode"],
                "isHost": isHost === true,
                "name": detail["name"] ?? "",
                "isUnsupervised": detail["isUnsupervised"] === true
            };
            await setJoin(detail["joinId"], record);
            records.set(detail["joinId"], {...record, "joinId": detail["joinId"], "isOnline": true});
            emitChange();
            return records.get(detail["joinId"]);
        },

        // what this client calls the other side of a connection. It is written
        // on the row as well as here, so another window of this device is handed
        // it back; the other side keeps the name it gave, which is its own.
        async rename(joinId, name) {
            const record = records.get(joinId);
            if (record === undefined) {
                return undefined;
            }
            if (ctx["server"].isOnline === true) {
                await ctx["server"].joinRename(joinId, name);
            }
            await setJoin(joinId, {"name": name});
            records.set(joinId, {...record, "name": name});
            emitChange();
            return records.get(joinId);
        },

        // drop it here only - for a join the server has already forgotten
        async forget(joinId) {
            records.delete(joinId);
            await removeJoin(joinId);
            emitChange();
        },

        // and drop it on both sides, which is what the delete on a card means
        async remove(joinId) {
            if (ctx["server"].isOnline === true) {
                await ctx["server"].joinDelete(joinId);
            }
            await joins.forget(joinId);
        },

        "get": function(joinId) {
            return records.get(joinId);
        }
    };

    // the other side arrived, or went. Only the edges are sent, and a record
    // this client no longer holds is nothing to draw.
    ctx["server"].addEventListener("join-online", function(event) {
        const record = records.get(event.detail?.["joinId"]);
        if (record === undefined) {
            return;
        }
        record["isOnline"] = (event.detail?.["isOnline"] === true);
        emitChange();
    });

    // the socket that knew who was there is gone, and nobody is reachable again
    // until connectAll() has presented the codes on the next one
    ctx["server"].addEventListener("offline", function() {
        for (const record of records.values()) {
            record["isOnline"] = false;
        }
        emitChange();
    });

    // the other side deleted it: this client keeps no card for a device that
    // will not answer again
    ctx["server"].addEventListener("join-remove", function(event) {
        const joinId = event.detail?.["joinId"];
        if (typeof joinId === "string") {
            joins.forget(joinId);
        }
    });

    return joins;
};

export { createJoins };
export default createJoins;
