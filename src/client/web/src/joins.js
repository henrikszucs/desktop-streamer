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

    const joins = {
        "records": records,

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
                    records.set(joinId, {
                        ...records.get(joinId),
                        "isHost": answer["isHost"],
                        "isUnsupervised": answer["isUnsupervised"],
                        "isOnline": answer["isOnline"]
                    });
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
            return records.get(detail["joinId"]);
        },

        // drop it here only - for a join the server has already forgotten
        async forget(joinId) {
            records.delete(joinId);
            await removeJoin(joinId);
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
