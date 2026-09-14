"use strict";

// the remembered devices this client holds, on both sides of them: the records
// in the local database, the codes they are reached with, and who is online.
//
// The two sides are kept in different places (see .claude/CLIENT.md). A share
// is the machine's: its record lives in the guest row whoever is signed in, so
// the host code never leaves this client and the shares screen shows the same
// list to every user of it. A device is the person's: its record lives in the
// row of the user this client is right now, so the devices screen shows only
// that user's, and for an account the server hands the same devices to any
// client it signs in on (join-sync) - the guest's are the codes it holds, and
// a guest that loses its row has lost them.
//
// One join, one side per client: a join this machine hosts is a share here and
// nothing else, since the device side of it is the other machine's - whoever
// is signed in on both. The two sides carry the same join id, so a device
// record with a share's id is never held or presented: one socket on both
// sides of a join would be a machine connecting to itself.

// first-party dependencies
import { getJoins, setJoin, removeJoin, GUEST_ID } from "./conf.js";

// the shell builds one of these and hands it to every module in ctx
const createJoins = function(ctx) {
    // joinId -> {joinCode, isHost, name, isUnsupervised, isOnline, isConnected}
    // - only what the current user is shown, the shares always among them
    const records = new Map();

    // what changed here is drawn elsewhere - the two screens keep their cards
    // right while they are open, so they are told rather than left to ask
    const events = new EventTarget();
    const emitChange = function() {
        events.dispatchEvent(new CustomEvent("change"));
    };

    // who the client is, and so whose devices are on screen
    const userId = function() {
        return ctx["account"]?.currentId() ?? GUEST_ID;
    };

    // the row a record is kept in: the machine's for a share, the user's for a
    // device
    const rowOf = function(isHost) {
        return (isHost === true ? GUEST_ID : userId());
    };

    // the user whose devices are held right now, and the presenting of them
    // in flight - a second connectAll() for the same user joins it rather than
    // presenting every code twice. The generation is what an answer that
    // arrives after the user changed is checked against: a code presented for
    // the old user must not put a record back that the switch took out.
    let heldUserId = GUEST_ID;
    let syncing = null;
    let syncingUserId = GUEST_ID;
    let generation = 0;

    // the records back from the rows: the shares from the guest row, the
    // devices from the current user's, which is the same row for the guest.
    // What is there already keeps what only this socket knows (who is online).
    const load = async function() {
        const id = userId();
        const guestRow = await getJoins(GUEST_ID);
        const userRow = (id === GUEST_ID ? guestRow : await getJoins(id));

        const wanted = new Map();
        for (const [joinId, record] of Object.entries(guestRow)) {
            if (record["isHost"] === true || id === GUEST_ID) {
                wanted.set(joinId, record);
            }
        }
        for (const [joinId, record] of Object.entries(userRow)) {
            if (record["isHost"] === true) {
                continue;
            }
            // a device with a share's id is this machine's own join, handed to
            // the account by a sync before the shares were kept apart from it:
            // the share is the record, and the row is put right
            if (wanted.get(joinId)?.["isHost"] === true) {
                await removeJoin(joinId, id);
                continue;
            }
            wanted.set(joinId, record);
        }
        for (const joinId of [...records.keys()]) {
            if (wanted.has(joinId) === false) {
                records.delete(joinId);
            }
        }
        for (const [joinId, record] of wanted) {
            records.set(joinId, {...records.get(joinId), ...record, "joinId": joinId});
        }
    };

    // the account's devices, from the server: a client this account signs in
    // on for the first time holds none of them, and one that does may be
    // behind on a name given elsewhere. A row it holds that the server does
    // not know is dropped by connectAll() below, on the code. A join this
    // machine hosts is among them when the peer was this same account, and it
    // stays the share it is here: the server cannot tell the two machines of
    // one person apart, and overwriting the share with its own device side is
    // how the shares went missing at a sign-in.
    const syncAccount = async function() {
        const id = userId();
        if (id === GUEST_ID || ctx["server"].isOnline !== true) {
            return;
        }
        let synced = [];
        try {
            synced = await ctx["server"].joinSync();
        } catch (error) {
            console.error("Cannot sync the devices of " + id + ":", error);
            return;
        }
        for (const entry of synced) {
            const joinId = entry["joinId"];
            const held = records.get(joinId);
            if (held?.["isHost"] === true) {
                continue;
            }
            const record = {
                "joinCode": entry["joinCode"],
                "isHost": false,
                "name": (typeof entry["name"] === "string" && entry["name"] !== "" ? entry["name"] : (held?.["name"] ?? "")),
                "isUnsupervised": entry["isUnsupervised"] === true
            };
            if (held === undefined || held["joinCode"] !== record["joinCode"] || held["name"] !== record["name"]) {
                await setJoin(joinId, record, id);
            }
            records.set(joinId, {...held, ...record, "joinId": joinId});
        }
    };

    // one code presented. The name is on the row too, so this is where a device
    // that named the connection elsewhere gets it back - an empty one is a row
    // nobody named, not a name somebody cleared.
    const connectOne = async function(joinId, ownGeneration) {
        const record = records.get(joinId);
        if (record === undefined || record["isConnected"] === true) {
            return;
        }
        try {
            const answer = await ctx["server"].joinConnect(record["joinCode"]);
            if (ownGeneration !== generation || records.has(joinId) === false) {
                return;     // the user changed under this call, or the record went
            }
            const merged = {
                ...record,
                "isHost": answer["isHost"],
                "isUnsupervised": answer["isUnsupervised"],
                "isOnline": answer["isOnline"],
                "isConnected": true
            };
            if (typeof answer["name"] === "string" && answer["name"] !== "") {
                merged["name"] = answer["name"];
                if (record["name"] !== answer["name"]) {
                    await setJoin(joinId, {"name": answer["name"]}, rowOf(merged["isHost"]));
                }
            }
            records.set(joinId, merged);
        } catch (error) {
            // the row is gone: the other side forgot this device, and a code
            // that opens nothing is worth keeping no longer
            if (error.message === "unknown-join") {
                await joins.forget(joinId);
                return;
            }
            console.error("Cannot connect join " + joinId + ":", error);
        }
    };

    const joins = {
        "records": records,

        // events: change
        "addEventListener": events.addEventListener.bind(events),
        "removeEventListener": events.removeEventListener.bind(events),

        // how many of the devices on one side of this client are there right
        // now. Presence is pushed, so this is an answer rather than an age.
        // Nothing on the bars reads it: a device that is online is one that
        // could ask, and the badge is for a connection that stands.
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
        // comes from the server, and only when somebody is looking. A sync in
        // flight is waited for, so a screen drawn right after an account switch
        // is drawn from the new user's records once they are presented, rather
        // than from records the server does not hold this socket on yet. It
        // emits nothing: the screen that asked draws the answer itself.
        async list(isHost) {
            if (syncing !== null) {
                await syncing;
            } else {
                await load();
            }

            // a join this client holds but the server does not know is gone -
            // dropped by the other side while this one was away
            if (ctx["server"].isOnline === true) {
                const live = await ctx["server"].joinList();
                const online = new Map(live.map(function(entry) {
                    return [entry["joinId"], entry];
                }));
                for (const record of records.values()) {
                    const entry = online.get(record["joinId"]);
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
        // Called on every online, and again by an account switch; a code that
        // is already presented on this socket is left alone. `dropped` is what
        // a switch takes off the socket first, inside the same wait, so that a
        // screen waiting on the sync sees neither the old devices nor the new
        // ones before they are presented.
        connectAll(dropped=[]) {
            const id = userId();
            if (syncing !== null && syncingUserId === id && dropped.length === 0) {
                return syncing;
            }
            syncingUserId = id;
            heldUserId = id;
            const ownGeneration = ++generation;
            const own = (async function() {
                try {
                    if (dropped.length > 0) {
                        try {
                            await ctx["server"].joinDisconnect(dropped);
                        } catch (error) {
                            console.error(error);
                        }
                    }
                    if (ownGeneration !== generation) {
                        return;     // a newer sync took over
                    }
                    await load();
                    await syncAccount();
                    for (const joinId of [...records.keys()]) {
                        if (ownGeneration !== generation) {
                            return;
                        }
                        await connectOne(joinId, ownGeneration);
                    }
                } finally {
                    if (syncing === own) {
                        syncing = null;
                    }
                }
                emitChange();
            })();
            syncing = own;
            return own;
        },

        // the client is somebody else now: the old user's devices come off the
        // screen and off this socket on the server, the shares stay where they
        // are, and the new user's devices are loaded and presented
        async switchUser() {
            const id = userId();
            if (id === heldUserId) {
                return;
            }
            heldUserId = id;
            const dropped = [];
            for (const [joinId, record] of records) {
                if (record["isHost"] !== true) {
                    dropped.push(joinId);
                    records.delete(joinId);
                }
            }
            // the sync is started before the change is told, so a screen that
            // answers the change waits on it rather than drawing the new
            // user's devices before the server holds this socket on them
            const sync = joins.connectAll(dropped);
            emitChange();
            await sync;
        },

        // what a pair-accept hands back, on either side of it. The device side
        // of a join this machine already hosts is not kept - see the top of
        // this file - which only ever happens to two windows of one browser
        // pairing with each other over the one guest row they share.
        async remember(detail, isHost) {
            if (detail?.["isRemember"] !== true || typeof detail["joinId"] !== "string") {
                return undefined;
            }
            if (isHost !== true && records.get(detail["joinId"])?.["isHost"] === true) {
                return undefined;
            }
            const record = {
                "joinCode": detail["joinCode"],
                "isHost": isHost === true,
                "name": detail["name"] ?? "",
                "isUnsupervised": detail["isUnsupervised"] === true
            };
            await setJoin(detail["joinId"], record, rowOf(record["isHost"]));

            // the server put both sides on it as it accepted, so this socket is
            // already presented on the code
            records.set(detail["joinId"], {...record, "joinId": detail["joinId"], "isOnline": true, "isConnected": true});
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
            await setJoin(joinId, {"name": name}, rowOf(record["isHost"]));
            records.set(joinId, {...record, "name": name});
            emitChange();
            return records.get(joinId);
        },

        // drop it here only - for a join the server has already forgotten. A
        // record this client is not holding right now is looked for in both
        // rows, since the push does not say which side it was.
        async forget(joinId) {
            const record = records.get(joinId);
            records.delete(joinId);
            if (record !== undefined) {
                await removeJoin(joinId, rowOf(record["isHost"]));
            } else {
                await removeJoin(joinId, GUEST_ID);
                if (userId() !== GUEST_ID) {
                    await removeJoin(joinId, userId());
                }
            }
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
        },

        // this client is a new guest: the rows are gone, so nothing is held or
        // drawn for them here, and the server is told to stop answering for
        // this socket on codes it no longer holds
        async reset() {
            records.clear();
            emitChange();
            await ctx["server"].joinDisconnect();
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
            record["isConnected"] = false;
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

    // the client became somebody else - a sign-in, a switch, a sign-out, a
    // session ended from another device. The account says so for every
    // change of its own as well, so who it is now is compared to who the
    // devices on screen belong to.
    ctx["account"]?.addEventListener("change", function() {
        joins.switchUser().catch(function(error) {
            console.error(error);
        });
    });

    return joins;
};

export { createJoins };
export default createJoins;
