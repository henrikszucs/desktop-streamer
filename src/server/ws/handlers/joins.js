"use strict";

// what a host remembers about a device it let in once: the `joins` row that
// outlives both sockets, the two codes that decide which side a socket is on,
// and the way back in for a device that returns.
//
// A join is made by `pair-accept` when the host ticks "remember". After that the
// peer needs no code from anybody: it presents the one it was given, and either
// the host is asked again (supervised) or it is not (unsupervised) - which is
// the whole difference between the two flags.
//
// **The two sides are kept differently.** A share is the machine's: the host
// code lives in that client alone and `host_user_id` stays empty, whoever is
// signed in there. A device is the person's: `peer_user_id` is the account the
// peer was signed in as when the pair was made, and `join-sync` hands that
// account its devices on any client it signs in on - so for an account the
// sign-in is the credential, and for a guest the code still is.

// first-party dependencies
import { generateId } from "../../common.js";
import { push, notify, notifyAll, ANSWER_TIMEOUT } from "../notify.js";
import { addressOf } from "../address.js";
import { createRoom, closeJoinRooms, closeRoomsOf } from "./rooms.js";

// a join code is a capability, not something anybody reads out: it is ten
// characters of the full alphabet, where a pair code is six digits
const JOIN_CODE_LENGTH = 10;

// the search gives up rather than spinning, as the pair codes do
const JOIN_CODE_ATTEMPTS = 100;

// a name is a label on a card, not a document: the input that writes one is
// capped at the same length
const JOIN_NAME_MAX = 64;

// a code no row holds. The two codes of one join must differ from each other as
// well, since which one a socket presents is what decides the side it is on.
const generateJoinCodes = async function(db) {
    for (let i = 0; i < JOIN_CODE_ATTEMPTS; i++) {
        const peerCode = generateId(JOIN_CODE_LENGTH);
        const hostCode = generateId(JOIN_CODE_LENGTH);
        if (peerCode === hostCode) {
            continue;
        }
        const taken = await db("joins")
            .whereIn("peer_code", [peerCode, hostCode])
            .orWhereIn("host_code", [peerCode, hostCode])
            .first();
        if (typeof taken === "undefined") {
            return {"peerCode": peerCode, "hostCode": hostCode};
        }
    }
    return undefined;
};

const generateJoinId = async function(db) {
    for (let i = 0; i < JOIN_CODE_ATTEMPTS; i++) {
        const joinId = generateId(10);
        const taken = await db("joins").where("join_id", joinId).first();
        if (typeof taken === "undefined") {
            return joinId;
        }
    }
    return undefined;
};

// the row of a remembered pair, written once and read back by either code.
// Called by pair-accept, which is the only thing that makes one. `peerUserId`
// is the account the peer is signed in as, "" for a guest - the host side has
// no owner on purpose, see the top of this file.
const createJoin = async function(server, isUnsupervised, peerUserId="") {
    const db = server.db;
    if (db === null) {
        return undefined;       // nothing to remember it in
    }

    const joinId = await generateJoinId(db);
    const codes = await generateJoinCodes(db);
    if (joinId === undefined || codes === undefined) {
        return undefined;
    }
    const owner = (typeof peerUserId === "string" ? peerUserId : "");

    /*{
        "join_id", "peer_code", "host_code", "peer_user_id", "host_user_id",
        "peer_name", "host_name", "is_unsupervised", "created"
    }*/
    await db("joins").insert({
        "join_id": joinId,
        "peer_code": codes["peerCode"],
        "host_code": codes["hostCode"],
        "peer_user_id": owner,
        "host_user_id": "",
        "peer_name": "",
        "host_name": "",
        "is_unsupervised": isUnsupervised === true,
        "created": Date.now()
    });

    return {
        "joinId": joinId,
        "peerCode": codes["peerCode"],
        "hostCode": codes["hostCode"],
        "isUnsupervised": isUnsupervised === true,
        "peerUserId": owner
    };
};

//
// the joins a socket is holding open
//
// `server.joins` holds a join while at least one socket of either side is on it,
// and nothing longer: the row in the database is what a join *is*, this is only
// who can be reached about it right now.
const attachJoin = function(server, sessionId, record, isHost) {
    const joinId = record["joinId"];
    let join = server.joins.get(joinId);
    if (join === undefined) {
        /*{
            "joinId", "peerCode", "hostCode", "isUnsupervised",
            "peerUserId": string,           (the account the device is, "" for a guest's)
            "hostSessionIds": Set, "peerSessionIds": Set,
            "requestSessionId": string,     (the peer waiting for an answer)
            "answerSessionId": string,      (the host socket that was asked)
            "answerTimeoutId": Timeout
        }*/
        join = new Map([
            ["joinId", joinId],
            ["peerCode", record["peerCode"]],
            ["hostCode", record["hostCode"]],
            ["isUnsupervised", record["isUnsupervised"] === true],
            ["peerUserId", typeof record["peerUserId"] === "string" ? record["peerUserId"] : ""],
            ["hostSessionIds", new Set()],
            ["peerSessionIds", new Set()]
        ]);
        server.joins.set(joinId, join);
    }
    const client = server.clients.get(sessionId);
    if (client === undefined) {
        // the socket went while the row was being read. Nothing will detach it,
        // so an entry created for it here would be held for the process life
        dropIfEmpty(server, join);
        return join;
    }
    const sessionIds = join.get(isHost === true ? "hostSessionIds" : "peerSessionIds");
    const wasOnline = (sessionIds.size > 0);
    sessionIds.add(sessionId);
    if (client.has("joinIds") === false) {
        client.set("joinIds", new Set());
    }
    client.get("joinIds").add(joinId);

    // the first socket of a side is that side coming online
    if (wasOnline === false) {
        notifyPresence(server, join, isHost);
    }
    return join;
};

// a database row in the words the rest of this file uses. SQLite has no boolean,
// so what comes back for one is a 0 or a 1.
const recordOf = function(row) {
    return {
        "joinId": row["join_id"],
        "peerCode": row["peer_code"],
        "hostCode": row["host_code"],
        "isUnsupervised": row["is_unsupervised"] === true || row["is_unsupervised"] === 1,
        "peerUserId": typeof row["peer_user_id"] === "string" ? row["peer_user_id"] : ""
    };
};

// the other side of a join, as sockets to talk to
const otherSide = function(join, isHost) {
    return join.get(isHost === true ? "peerSessionIds" : "hostSessionIds");
};

const isOnline = function(join, isHost) {
    return otherSide(join, isHost).size > 0;
};

// one side arrived or left, and the other is told rather than left to ask again:
// a client that draws presence anywhere but on a screen it has just opened has
// nothing to poll with. Only the edges are pushed - a second window of a device
// that is already there changes nothing about whether it is there.
const notifyPresence = function(server, join, isHost) {
    notifyAll(server, otherSide(join, isHost), {
        "type": "join-online",
        "joinId": join.get("joinId"),
        "isOnline": join.get(isHost === true ? "hostSessionIds" : "peerSessionIds").size > 0
    });
};

// a pending request is over: the clock is cleared and the peer that was waiting
// is handed back, so every ending can tell it what happened
const releaseRequest = function(join) {
    clearTimeout(join.get("answerTimeoutId"));
    join.delete("answerTimeoutId");
    join.delete("answerSessionId");

    const requestSessionId = join.get("requestSessionId");
    join.delete("requestSessionId");
    return requestSessionId;
};

// the memory entry goes when the last socket on it does - the row stays, which
// is what being remembered means
const dropIfEmpty = function(server, join) {
    if (join.get("hostSessionIds").size > 0 || join.get("peerSessionIds").size > 0) {
        return;
    }
    releaseRequest(join);
    server.joins.delete(join.get("joinId"));
};

// one socket leaves every join it was on, or only the ones named. Called from
// the close handler, so a device that goes offline stops being reachable and a
// request it was waiting on does not outlive it - and by join-disconnect, where
// a client switching accounts drops the old one's devices and nothing else.
const detachJoins = function(server, sessionId, onlyJoinIds=undefined) {
    const client = server.clients.get(sessionId);
    const held = client?.get("joinIds");
    if (held === undefined) {
        return;
    }
    let joinIds = held;
    if (Array.isArray(onlyJoinIds) === true) {
        joinIds = new Set(onlyJoinIds.filter(function(joinId) {
            return held.has(joinId);
        }));
        for (const joinId of joinIds) {
            held.delete(joinId);
        }
    } else {
        client.delete("joinIds");
    }

    for (const joinId of joinIds) {
        const join = server.joins.get(joinId);
        if (join === undefined) {
            continue;
        }
        const isHost = join.get("hostSessionIds").delete(sessionId);
        const isPeer = join.get("peerSessionIds").delete(sessionId);

        // whoever was in the middle of asking, or being asked, is told
        if (join.get("requestSessionId") === sessionId) {
            releaseRequest(join);
            notifyAll(server, join.get("hostSessionIds"), {
                "type": "join-cancel",
                "joinId": joinId,
                "reason": "cancelled"
            });
        } else if (isHost === true && join.get("answerSessionId") === sessionId) {
            const requestSessionId = releaseRequest(join);
            if (requestSessionId !== undefined) {
                notify(server, requestSessionId, {
                    "type": "join-reject",
                    "joinId": joinId,
                    "reason": "gone"
                });
            }
        }

        // and the last socket of a side is that side going away
        if ((isHost === true || isPeer === true) && join.get(isHost === true ? "hostSessionIds" : "peerSessionIds").size === 0) {
            notifyPresence(server, join, isHost);
        }
        dropIfEmpty(server, join);
    }
};

// the whole table, for a server that is stopping
const releaseJoins = function(server) {
    for (const join of server.joins.values()) {
        clearTimeout(join.get("answerTimeoutId"));
    }
    server.joins.clear();
};

// the row a code opens, and which side of it the caller is on
const findJoin = async function(server, joinCode) {
    if (server.db === null || typeof joinCode !== "string" || joinCode === "") {
        return undefined;
    }
    const row = await server.db("joins")
        .where("peer_code", joinCode)
        .orWhere("host_code", joinCode)
        .first();
    if (typeof row === "undefined") {
        return undefined;
    }
    return {"row": row, "isHost": row["host_code"] === joinCode};
};

// the join a caller is on, from the memory table alone: a call about a join this
// socket never connected is not answered from the database
const heldJoin = function(server, sessionId, joinId) {
    const join = server.joins.get(joinId);
    if (join === undefined) {
        return undefined;
    }
    if (join.get("hostSessionIds").has(sessionId) === true) {
        return {"join": join, "isHost": true};
    }
    if (join.get("peerSessionIds").has(sessionId) === true) {
        return {"join": join, "isHost": false};
    }
    return undefined;
};

//
// the calls
//
// a device says which remembered join it is on. Both sides do it, and both do it
// for every code they hold: a host that is not connected to its own joins cannot
// be asked about them.
const joinConnect = async function(ctx) {
    /*{
        "joinCode": string
    }*/
    /*{
        "success": boolean,
        "joinId": string,
        "isHost": boolean,
        "isUnsupervised": boolean,
        "name": string,
        "isOnline": boolean,
        "error": string
    }*/
    const server = ctx["server"];
    const found = await findJoin(server, ctx["message"]["joinCode"]);
    if (found === undefined) {
        // the row is gone, or was never there: the caller should forget the code
        ctx["messageObj"].send({"success": false, "error": "unknown-join"});
        return;
    }

    // the device side of a join an account owns is that account's: its code
    // opens it only on a socket signed in as the account, so a code that got
    // out - or one kept by a session that has since been signed out - opens
    // nothing. A guest's device is its code alone, and a share is the machine's.
    const owner = recordOf(found["row"])["peerUserId"];
    if (found["isHost"] === false && owner !== "" && server.clients.get(ctx["sessionId"])?.get("userId") !== owner) {
        ctx["messageObj"].send({"success": false, "error": "not-allowed"});
        return;
    }

    const join = attachJoin(server, ctx["sessionId"], recordOf(found["row"]), found["isHost"]);
    ctx["messageObj"].send({
        "success": true,
        "joinId": found["row"]["join_id"],
        "isHost": found["isHost"],
        "isUnsupervised": join.get("isUnsupervised"),
        "name": found["isHost"] === true ? found["row"]["peer_name"] : found["row"]["host_name"],
        "isOnline": isOnline(join, found["isHost"])
    });
};

// what this connection is on, for the two screens that list them. The client
// knows its own joins from its codes; what it cannot know is who is online.
const joinList = function(ctx) {
    /*{
    }*/
    /*{
        "success": boolean,
        "joins": [{"joinId", "isHost", "isUnsupervised", "isOnline"}]
    }*/
    const server = ctx["server"];
    const joinIds = server.clients.get(ctx["sessionId"])?.get("joinIds") ?? new Set();

    const joins = [];
    for (const joinId of joinIds) {
        const held = heldJoin(server, ctx["sessionId"], joinId);
        if (held === undefined) {
            continue;
        }
        joins.push({
            "joinId": joinId,
            "isHost": held["isHost"],
            "isUnsupervised": held["join"].get("isUnsupervised"),
            "isOnline": isOnline(held["join"], held["isHost"])
        });
    }
    ctx["messageObj"].send({"success": true, "joins": joins});
};

// what the caller calls the other side of a join. Each side names the other
// independently - `peer_name` and `host_name` are separate columns - so this
// writes one of them and nothing is pushed anywhere: the other side goes on
// seeing whatever it named this one. It is on the row rather than only in the
// client so that a device presenting the same code again is handed it back.
const joinRename = async function(ctx) {
    /*{
        "joinId": string,
        "name": string
    }*/
    /*{
        "success": boolean,
        "name": string,
        "error": string
    }*/
    const server = ctx["server"];
    const held = heldJoin(server, ctx["sessionId"], ctx["message"]["joinId"]);
    if (held === undefined) {
        ctx["messageObj"].send({"success": false, "error": "unknown-join"});
        return;
    }

    const name = ctx["message"]["name"];
    if (typeof name !== "string" || name.length > JOIN_NAME_MAX) {
        ctx["messageObj"].send({"success": false, "error": "invalid-name"});
        return;
    }

    // the caller's own column: a host names the peer, a peer names the host,
    // which is the same side join-connect reads the name back from
    if (server.db !== null) {
        await server.db("joins")
            .where("join_id", held["join"].get("joinId"))
            .update(held["isHost"] === true ? {"peer_name": name} : {"host_name": name});
    }
    ctx["messageObj"].send({"success": true, "name": name});
};

// the peer wants in, on a pairing that was made before. Supervised, the host is
// asked exactly as it was the first time; unsupervised, nobody is disturbed -
// that is what the host agreed to when it ticked the box.
const joinRequest = async function(ctx) {
    /*{
        "joinId": string
    }*/
    /*{
        "success": boolean,
        "isAccepted": boolean,
        "timeout": number,
        "error": string
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];
    const messageObj = ctx["messageObj"];

    const held = heldJoin(server, sessionId, ctx["message"]["joinId"]);
    if (held === undefined || held["isHost"] === true) {
        messageObj.send({"success": false, "error": "unknown-join"});
        return;
    }
    const join = held["join"];

    const hostSessionIds = join.get("hostSessionIds");
    if (hostSessionIds.size === 0) {
        messageObj.send({"success": false, "error": "offline"});
        return;
    }
    if (join.has("requestSessionId") === true) {
        messageObj.send({"success": false, "error": "busy"});
        return;
    }

    // the host agreed once, for every time: nobody is asked again. It is still
    // put in the room with this peer - it has a connection to negotiate either
    // way, and the room-open push is the only thing that tells it so.
    if (join.get("isUnsupervised") === true) {
        createRoom(server, [...hostSessionIds][0], sessionId, join.get("joinId"));
        messageObj.send({"success": true, "isAccepted": true});
        return;
    }

    // one host socket is asked - the first of them, as the relay will be
    const hostSessionId = [...hostSessionIds][0];
    join.set("requestSessionId", sessionId);
    join.set("answerSessionId", hostSessionId);
    join.set("answerTimeoutId", setTimeout(function() {
        rejectRequest(server, join, "timeout");
    }, ANSWER_TIMEOUT));

    const client = server.clients.get(sessionId);
    push(server, hostSessionId, {
        "type": "join-request",
        "joinId": join.get("joinId"),
        "details": {
            "ipAddress": addressOf(server, sessionId),
            "isUser": typeof client?.get("userId") === "string"
        },
        "timeout": ANSWER_TIMEOUT
    }, ANSWER_TIMEOUT).then(function(isDelivered) {
        if (isDelivered === true || join.get("requestSessionId") !== sessionId) {
            return;
        }
        rejectRequest(server, join, "gone");     // it never got there
    });

    messageObj.send({"success": true, "isAccepted": false, "timeout": ANSWER_TIMEOUT});
};

// no, from the host or from the clock. Unlike a pair code there is nothing to
// replace: the join stands, and the peer may ask again.
const rejectRequest = function(server, join, reason) {
    const hostSessionIds = new Set(join.get("hostSessionIds"));
    const requestSessionId = releaseRequest(join);
    if (requestSessionId === undefined) {
        return;
    }
    notify(server, requestSessionId, {
        "type": "join-reject",
        "joinId": join.get("joinId"),
        "reason": reason
    });
    if (reason !== "rejected") {
        notifyAll(server, hostSessionIds, {
            "type": "join-cancel",
            "joinId": join.get("joinId"),
            "reason": reason
        });
    }
};

const joinAccept = function(ctx) {
    /*{
        "joinId": string
    }*/
    /*{
        "success": boolean,
        "error": string
    }*/
    const server = ctx["server"];
    const held = heldJoin(server, ctx["sessionId"], ctx["message"]["joinId"]);
    if (held === undefined || held["isHost"] === false || held["join"].has("requestSessionId") === false) {
        ctx["messageObj"].send({"success": false, "error": "no-request"});
        return;
    }

    const requestSessionId = releaseRequest(held["join"]);
    notify(server, requestSessionId, {
        "type": "join-accept",
        "joinId": held["join"].get("joinId")
    });
    ctx["messageObj"].send({"success": true});

    // the two of them are in a room now, exactly as an accepted pairing is
    createRoom(server, ctx["sessionId"], requestSessionId, held["join"].get("joinId"));
};

// no, from either side of it: the host deciding against it, or the peer giving
// up the wait
const joinReject = function(ctx) {
    /*{
        "joinId": string
    }*/
    /*{
        "success": boolean
    }*/
    const server = ctx["server"];
    const held = heldJoin(server, ctx["sessionId"], ctx["message"]["joinId"]);
    if (held !== undefined) {
        const join = held["join"];
        if (held["isHost"] === true) {
            rejectRequest(server, join, "rejected");
        } else if (join.get("requestSessionId") === ctx["sessionId"]) {
            const hostSessionIds = new Set(join.get("hostSessionIds"));
            releaseRequest(join);
            notifyAll(server, hostSessionIds, {
                "type": "join-cancel",
                "joinId": join.get("joinId"),
                "reason": "cancelled"
            });
        }
    }
    ctx["messageObj"].send({"success": true});
};

// a join is gone for good: the row, the memory entry, and a card on every
// socket that was on it - except the ones that asked, which have an answer
// coming. Shared by join-delete and by an account being deleted.
const dropJoin = async function(server, joinId, exceptSessionIds=new Set()) {
    const join = server.joins.get(joinId);
    const sessionIds = (join === undefined
        ? new Set()
        : new Set([...join.get("hostSessionIds"), ...join.get("peerSessionIds")]));
    if (join !== undefined) {
        rejectRequest(server, join, "removed");
    }

    if (server.db !== null) {
        await server.db("joins").where("join_id", joinId).del();
    }
    // and whatever is connected through it is not any more: a device that is
    // forgotten does not stay on the host's keyboard (see closeJoinRooms)
    closeJoinRooms(server, joinId, "removed");
    for (const sessionId of sessionIds) {
        server.clients.get(sessionId)?.get("joinIds")?.delete(joinId);
    }
    server.joins.delete(joinId);

    const others = new Set([...sessionIds].filter(function(sessionId) {
        return exceptSessionIds.has(sessionId) === false;
    }));
    notifyAll(server, others, {"type": "join-remove", "joinId": joinId});
};

// either side forgets the other. The row goes, so both codes stop opening
// anything, and whoever is connected is told rather than left with a card that
// answers nothing - the caller's own other windows included, since the record
// they draw from is the account's or the machine's, not the window's.
const joinDelete = async function(ctx) {
    /*{
        "joinId": string
    }*/
    /*{
        "success": boolean
    }*/
    const server = ctx["server"];
    const joinId = ctx["message"]["joinId"];
    const held = heldJoin(server, ctx["sessionId"], joinId);
    if (held === undefined) {
        ctx["messageObj"].send({"success": true});
        return;
    }
    await dropJoin(server, joinId, new Set([ctx["sessionId"]]));
    ctx["messageObj"].send({"success": true});
};

// the devices of an account go with it: every join it is the peer of is
// dropped, and each host is told the way a join-delete tells it. Called by
// the account deletion in handlers/accounts.js before the users row goes.
const removeUserJoins = async function(server, userId) {
    if (server.db === null || typeof userId !== "string" || userId === "") {
        return 0;
    }
    const rows = await server.db("joins").where("peer_user_id", userId).select("join_id");
    for (const row of rows) {
        await dropJoin(server, row["join_id"]);
    }
    return rows.length;
};

// the devices of the account this socket is signed in as, codes included: a
// device is the person's rather than the client's, so an account signing in
// on a new machine is handed them here and presents each with join-connect,
// exactly as a client that had them stored would. A guest is answered nothing
// - its devices are the codes it holds, and the server cannot tell one guest
// from another.
const joinSync = async function(ctx) {
    /*{
    }*/
    /*{
        "success": boolean,
        "joins": [{"joinId", "joinCode", "name", "isUnsupervised"}],
        "error": string
    }*/
    const server = ctx["server"];
    const userId = server.clients.get(ctx["sessionId"])?.get("userId");
    if (typeof userId !== "string" || userId === "") {
        ctx["messageObj"].send({"success": false, "error": "not-signed-in"});
        return;
    }
    if (server.db === null) {
        ctx["messageObj"].send({"success": true, "joins": []});
        return;
    }
    const rows = await server.db("joins").where("peer_user_id", userId);
    ctx["messageObj"].send({
        "success": true,
        "joins": rows.map(function(row) {
            return {
                "joinId": row["join_id"],
                "joinCode": row["peer_code"],
                "name": row["host_name"],
                "isUnsupervised": recordOf(row)["isUnsupervised"]
            };
        })
    });
};

// the caller is off every join it presented - or only the ones it names - as if
// its socket had closed for them. The rows stay, since forgetting them is each
// side's own (join-delete). A guest signing out calls it bare; a client
// switching accounts calls it with the old account's devices, so its shares
// stay reachable while the devices change hands. Without this the server would
// go on answering for a device that is not there until the socket actually went.
const joinDisconnect = function(ctx) {
    /*{
        "joinIds": [string]     (optional: only these)
    }*/
    /*{
        "success": boolean
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];
    const joinIds = ctx["message"]["joinIds"];
    const named = (Array.isArray(joinIds) === true ? joinIds : undefined);

    // as if the socket had closed for them, the connections made through them
    // end as well - a guest signing out is not left in a room on a device it
    // has just let go of
    const leaving = [...(server.clients.get(sessionId)?.get("joinIds") ?? [])].filter(function(joinId) {
        return named === undefined || named.includes(joinId);
    });
    closeRoomsOf(server, sessionId, new Set(leaving), "gone");
    detachJoins(server, sessionId, named);
    ctx["messageObj"].send({"success": true});
};

// the devices of one account a socket was on, taken off it. For an account the
// sign-in is the credential (see the top of this file), so a socket that stops
// being that user - signed out, recovered from, switched away - holds its
// devices no longer, and the connections it made through them end with it.
// Called by detachAccount in handlers/accounts.js.
const detachUserJoins = function(server, sessionId, userId) {
    const held = server.clients.get(sessionId)?.get("joinIds");
    if (held === undefined || typeof userId !== "string" || userId === "") {
        return;
    }
    const joinIds = [...held].filter(function(joinId) {
        const join = server.joins.get(joinId);
        return join !== undefined && join.get("peerUserId") === userId
            && join.get("peerSessionIds").has(sessionId) === true;
    });
    if (joinIds.length === 0) {
        return;
    }
    closeRoomsOf(server, sessionId, new Set(joinIds), "gone");
    detachJoins(server, sessionId, joinIds);
};

// the types this group answers
const handlers = {
    "join-connect": joinConnect,
    "join-list": joinList,
    "join-rename": joinRename,
    "join-request": joinRequest,
    "join-accept": joinAccept,
    "join-reject": joinReject,
    "join-delete": joinDelete,
    "join-disconnect": joinDisconnect,
    "join-sync": joinSync
};

export { handlers, createJoin, attachJoin, recordOf, detachJoins, detachUserJoins, releaseJoins, findJoin, heldJoin, isOnline, notifyPresence, generateJoinCodes, dropJoin, removeUserJoins, joinConnect, joinList, joinRename, joinRequest, joinAccept, joinReject, joinDelete, joinDisconnect, joinSync, JOIN_CODE_LENGTH, JOIN_NAME_MAX };
export default handlers;
