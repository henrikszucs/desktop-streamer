"use strict";

// what a host remembers about a device it let in once: the `joins` row that
// outlives both sockets, the two codes that stand in for an account until
// dev/plans/ws-accounts.md lands, and the way back in for a device that returns.
//
// A join is made by `pair-accept` when the host ticks "remember". After that the
// peer needs no code from anybody: it presents the one it was given, and either
// the host is asked again (supervised) or it is not (unsupervised) - which is
// the whole difference between the two flags.

// first-party dependencies
import { generateId } from "../../common.js";
import { push, notify, notifyAll, ANSWER_TIMEOUT } from "../notify.js";

// a join code is a capability, not something anybody reads out: it is ten
// characters of the full alphabet, where a pair code is six digits
const JOIN_CODE_LENGTH = 10;

// the search gives up rather than spinning, as the pair codes do
const JOIN_CODE_ATTEMPTS = 100;

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
// Called by pair-accept, which is the only thing that makes one.
const createJoin = async function(server, isUnsupervised) {
    const db = server.db;
    if (db === null) {
        return undefined;       // nothing to remember it in
    }

    const joinId = await generateJoinId(db);
    const codes = await generateJoinCodes(db);
    if (joinId === undefined || codes === undefined) {
        return undefined;
    }

    /*{
        "join_id", "peer_code", "host_code", "peer_user_id", "host_user_id",
        "peer_name", "host_name", "is_unsupervised", "created"
    }*/
    await db("joins").insert({
        "join_id": joinId,
        "peer_code": codes["peerCode"],
        "host_code": codes["hostCode"],
        "peer_user_id": "",
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
        "isUnsupervised": isUnsupervised === true
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
    join.get(isHost === true ? "hostSessionIds" : "peerSessionIds").add(sessionId);
    if (client.has("joinIds") === false) {
        client.set("joinIds", new Set());
    }
    client.get("joinIds").add(joinId);
    return join;
};

// a database row in the words the rest of this file uses. SQLite has no boolean,
// so what comes back for one is a 0 or a 1.
const recordOf = function(row) {
    return {
        "joinId": row["join_id"],
        "peerCode": row["peer_code"],
        "hostCode": row["host_code"],
        "isUnsupervised": row["is_unsupervised"] === true || row["is_unsupervised"] === 1
    };
};

// the other side of a join, as sockets to talk to
const otherSide = function(join, isHost) {
    return join.get(isHost === true ? "peerSessionIds" : "hostSessionIds");
};

const isOnline = function(join, isHost) {
    return otherSide(join, isHost).size > 0;
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

// one socket leaves every join it was on. Called from the close handler, so a
// device that goes offline stops being reachable and a request it was waiting on
// does not outlive it.
const detachJoins = function(server, sessionId) {
    const client = server.clients.get(sessionId);
    const joinIds = client?.get("joinIds");
    if (joinIds === undefined) {
        return;
    }
    client.delete("joinIds");

    for (const joinId of joinIds) {
        const join = server.joins.get(joinId);
        if (join === undefined) {
            continue;
        }
        const isHost = join.get("hostSessionIds").delete(sessionId);
        join.get("peerSessionIds").delete(sessionId);

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

    // the host agreed once, for every time: nobody is asked again
    if (join.get("isUnsupervised") === true) {
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
            "ipAddress": client?.get("ws")?._socket?.remoteAddress ?? "",
            "isUser": false
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

// either side forgets the other. The row goes, so both codes stop opening
// anything, and whoever is connected is told rather than left with a card that
// answers nothing.
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

    const join = held["join"];
    const others = new Set(otherSide(join, held["isHost"]));
    rejectRequest(server, join, "removed");

    if (server.db !== null) {
        await server.db("joins").where("join_id", joinId).del();
    }
    for (const sessionId of new Set([...join.get("hostSessionIds"), ...join.get("peerSessionIds")])) {
        server.clients.get(sessionId)?.get("joinIds")?.delete(joinId);
    }
    server.joins.delete(joinId);

    notifyAll(server, others, {"type": "join-remove", "joinId": joinId});
    ctx["messageObj"].send({"success": true});
};

// the types this group answers
const handlers = {
    "join-connect": joinConnect,
    "join-list": joinList,
    "join-request": joinRequest,
    "join-accept": joinAccept,
    "join-reject": joinReject,
    "join-delete": joinDelete
};

export { handlers, createJoin, attachJoin, recordOf, detachJoins, releaseJoins, findJoin, heldJoin, isOnline, generateJoinCodes, joinConnect, joinList, joinRequest, joinAccept, joinReject, joinDelete, JOIN_CODE_LENGTH };
export default handlers;
