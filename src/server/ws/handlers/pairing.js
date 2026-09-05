"use strict";

// the connection code a host hands out and the one join attempt it introduces:
// how a code is made, who may claim it, and the accept-or-reject that ends it.
// The join that would remember the pair, and the WebRTC signaling behind it, are
// still planned in dev/plans/ws-pairing-joins.md - an accepted request is the
// end of this file's story today.

// first-party dependencies
import { generateId } from "../../common.js";

// the code is read out loud, typed on a phone keypad and copied by hand, so it
// is six digits and nothing else - no letter that can be misread as a digit and
// no case to get wrong
const PAIR_CODE_LENGTH = 6;
const PAIR_CODE_CHARS = "0123456789";
const PAIR_CODE_PATTERN = /^[0-9]{6}$/;

// how long the host has to accept or reject. Both clients are told this number -
// the one waiting draws a bar that runs out, the one deciding draws the same bar
// on the button that happens by itself - so neither side is watching a spinner
// that means nothing. Silence is a rejection.
const PAIR_ANSWER_TIMEOUT = 5000;

// the search gives up instead of spinning: it only fails when the whole space is
// live - a million codes - and failing the call says so, where a loop would just
// stop answering
const PAIR_CODE_ATTEMPTS = 1000;

// a code no live pair holds
const generatePairCode = function(pairs) {
    for (let i = 0; i < PAIR_CODE_ATTEMPTS; i++) {
        const pairCode = generateId(PAIR_CODE_LENGTH, PAIR_CODE_CHARS);
        if (pairs.has(pairCode) === false) {
            return pairCode;
        }
    }
    return undefined;
};

// what the server says on its own, to a socket that is not waiting for an
// answer. A client that is already gone is not an error worth failing a call
// over, so this reports rather than throws.
const push = async function(server, sessionId, message, timeout) {
    const client = server.clients.get(sessionId);
    if (client === undefined) {
        return false;
    }
    try {
        message["timestamp"] = Date.now();
        const messageObj = client.get("com").send(message, [], timeout);
        await messageObj.wait();
        return messageObj.error === "";
    } catch (error) {
        console.log("Cannot notify client (" + sessionId + "):", error);
        return false;
    }
};

// the same, for a caller that is not waiting to hear whether it arrived
const notify = function(server, sessionId, message) {
    push(server, sessionId, message).catch(function() {});
};

// the code of one connection, remembered on both sides: the pair by its code,
// and the client by the code it holds, so a socket that goes away can be
// followed back to it
const addPairCode = function(server, sessionId) {
    const client = server.clients.get(sessionId);
    if (client === undefined) {
        return undefined;
    }

    const pairCode = generatePairCode(server.pairs);
    if (pairCode === undefined) {
        return undefined;
    }

    // A code has no life of its own: it stands while the host is offering it and
    // goes when the host does. What replaces one is a refusal, not a clock.
    /*{
        "hostSessionId": string,
        "peerSessionId": string,        (only while a request is pending)
        "answerTimeoutId": Timeout      (the life of a pending request)
    }*/
    const pair = new Map([
        ["hostSessionId", sessionId]
    ]);
    server.pairs.set(pairCode, pair);
    client.set("pairCode", pairCode);

    return pairCode;
};

// the peer half of a pair, taken off both the pair and the peer's own state.
// Every end of a request goes through it, or the code stays busy for a request
// nobody is waiting on any more.
const releasePeer = function(server, pair) {
    clearTimeout(pair.get("answerTimeoutId"));
    pair.delete("answerTimeoutId");

    const peerSessionId = pair.get("peerSessionId");
    if (peerSessionId === undefined) {
        return undefined;
    }
    pair.delete("peerSessionId");
    server.clients.get(peerSessionId)?.delete("pairCode");
    return peerSessionId;
};

// every way out of a code - a new one, the delete call, the timeout, the socket
// closing - goes through here, or the code is held for the life of the process.
// A connection is either the host of its code or the peer waiting on one, and
// the two leave very different things behind.
const removePairCode = function(server, sessionId) {
    const client = server.clients.get(sessionId);
    const pairCode = client?.get("pairCode");
    if (pairCode === undefined) {
        return;
    }
    client.delete("pairCode");

    const pair = server.pairs.get(pairCode);
    if (pair === undefined) {
        return;
    }

    // the peer gives up its side alone: the host keeps the code it is handing
    // out, since nobody decided anything
    if (pair.get("hostSessionId") !== sessionId) {
        if (pair.get("peerSessionId") !== sessionId) {
            return;     // a stale code on a client this pair no longer holds
        }
        releasePeer(server, pair);
        notify(server, pair.get("hostSessionId"), {
            "type": "pair-cancel",
            "reason": "cancelled"
        });
        return;
    }

    // the host takes the code with it, and a peer waiting on an answer that is
    // never coming is told so rather than left on its timeout
    const peerSessionId = releasePeer(server, pair);
    server.pairs.delete(pairCode);
    if (peerSessionId !== undefined) {
        notify(server, peerSessionId, {
            "type": "pair-reject",
            "reason": "gone"
        });
    }
};

// the whole table, for a server that is stopping: a pending timeout would hold
// the process open long after the last socket is gone
const releasePairCodes = function(server) {
    for (const pair of server.pairs.values()) {
        clearTimeout(pair.get("answerTimeoutId"));
    }
    server.pairs.clear();
};

// a refused code is not handed out again: the host is given a new one and told
// what it is, so the number somebody just tried to get in with is worth nothing
// to them a second time
const renewHostCode = function(server, hostSessionId) {
    removePairCode(server, hostSessionId);
    const pairCode = addPairCode(server, hostSessionId);
    if (pairCode === undefined) {
        return undefined;
    }
    notify(server, hostSessionId, {
        "type": "pair-code",
        "pairCode": pairCode
    });
    return pairCode;
};

// the answer was no, whoever it came from: the one waiting is told, the request
// is over, and the code that was refused is replaced
const rejectRequest = function(server, pairCode, reason) {
    const pair = server.pairs.get(pairCode);
    if (pair === undefined) {
        return;
    }
    const hostSessionId = pair.get("hostSessionId");
    const peerSessionId = releasePeer(server, pair);
    if (peerSessionId === undefined) {
        return;
    }
    notify(server, peerSessionId, {
        "type": "pair-reject",
        "reason": reason
    });

    // the host asked for this one itself, so it is only told when it did not -
    // the dialog it is looking at has to come down either way
    if (reason !== "rejected") {
        notify(server, hostSessionId, {
            "type": "pair-cancel",
            "reason": reason
        });
    }
    renewHostCode(server, hostSessionId);
};

// a host asks for the code it hands out. One connection holds one code, so a
// second ask replaces the first rather than adding to it.
const pairCreate = function(ctx) {
    /*{
    }*/
    /*{
        "success": boolean,
        "pairCode": string,
        "error": string
    }*/
    const server = ctx["server"];

    // every client is a guest until dev/plans/ws-accounts.md lands, so the guest
    // permission is the whole check here
    if (server.confPublic["permissions"]["guestAllowShare"] !== true) {
        ctx["messageObj"].send({
            "success": false,
            "error": "not-allowed"
        });
        return;
    }

    removePairCode(server, ctx["sessionId"]);
    const pairCode = addPairCode(server, ctx["sessionId"]);
    if (pairCode === undefined) {
        ctx["messageObj"].send({
            "success": false,
            "error": "no-pair-code"
        });
        return;
    }

    ctx["messageObj"].send({
        "success": true,
        "pairCode": pairCode
    });
};

// the host is done handing the code out - a client that closes its share dialog
// gives the code back rather than sitting on it until the socket goes
const pairDelete = function(ctx) {
    /*{
    }*/
    /*{
        "success": boolean
    }*/
    removePairCode(ctx["server"], ctx["sessionId"]);
    ctx["messageObj"].send({
        "success": true
    });
};

// somebody typed a code in. The host is asked, and until it answers the code is
// busy: one attempt at a time, so a second one is refused rather than queued
// behind a dialog the host is already looking at.
const pairRequest = function(ctx) {
    /*{
        "pairCode": string
    }*/
    /*{
        "success": boolean,
        "timeout": number,
        "error": string
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];
    const messageObj = ctx["messageObj"];

    if (server.confPublic["permissions"]["guestAllowJoin"] !== true) {
        messageObj.send({"success": false, "error": "not-allowed"});
        return;
    }

    const pairCode = ctx["message"]["pairCode"];
    if (typeof pairCode !== "string" || PAIR_CODE_PATTERN.test(pairCode) === false) {
        messageObj.send({"success": false, "error": "invalid-code"});
        return;
    }

    const pair = server.pairs.get(pairCode);
    if (pair === undefined) {
        messageObj.send({"success": false, "error": "unknown-code"});
        return;
    }
    const hostSessionId = pair.get("hostSessionId");
    if (hostSessionId === sessionId) {
        messageObj.send({"success": false, "error": "own-code"});
        return;
    }
    if (pair.get("peerSessionId") !== undefined) {
        messageObj.send({"success": false, "error": "busy"});
        return;
    }

    // a connection holds one pairing, so joining gives up whatever this one was
    // in before - its own share code included. It happens only once the join is
    // going ahead: a mistyped code must not cost the caller the code it is
    // handing out itself.
    removePairCode(server, sessionId);

    // taken before the first await, so two requests cannot both find it free
    const client = server.clients.get(sessionId);
    pair.set("peerSessionId", sessionId);
    client.set("pairCode", pairCode);

    // the host has this long, and saying nothing is saying no
    pair.set("answerTimeoutId", setTimeout(function() {
        rejectRequest(server, pairCode, "timeout");
    }, PAIR_ANSWER_TIMEOUT));

    // the host is told, not asked: it is a browser tab somebody has switched
    // away from - the very thing sharing is for - so its acknowledgment can be
    // seconds behind, and the one waiting is not held up for it. The window to
    // arrive in is the window to answer in, and a message that never gets there
    // ends the request rather than leaving it to the clock.
    push(server, hostSessionId, {
        "type": "pair-request",
        "details": {
            "ipAddress": client.get("ws")?._socket?.remoteAddress ?? "",
            "isUser": false
        },
        "timeout": PAIR_ANSWER_TIMEOUT
    }, PAIR_ANSWER_TIMEOUT).then(function(isDelivered) {
        if (isDelivered === true) {
            return;
        }
        if (server.pairs.get(pairCode) !== pair || pair.get("peerSessionId") !== sessionId) {
            return;     // the request ended on its own while the message was out
        }
        rejectRequest(server, pairCode, "gone");
    });

    messageObj.send({"success": true, "timeout": PAIR_ANSWER_TIMEOUT});
};

// the host said yes. The code is used up by it - introducing the two sides is
// all it is for - so nothing is left for a second caller to find.
const pairAccept = function(ctx) {
    /*{
    }*/
    /*{
        "success": boolean,
        "error": string
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];

    const pairCode = server.clients.get(sessionId)?.get("pairCode");
    const pair = (pairCode === undefined ? undefined : server.pairs.get(pairCode));
    if (pair === undefined || pair.get("hostSessionId") !== sessionId || pair.get("peerSessionId") === undefined) {
        ctx["messageObj"].send({"success": false, "error": "no-request"});
        return;
    }

    const peerSessionId = releasePeer(server, pair);
    server.pairs.delete(pairCode);
    server.clients.get(sessionId).delete("pairCode");

    notify(server, peerSessionId, {"type": "pair-accept"});
    ctx["messageObj"].send({"success": true});
};

// no, from either side of it. From the host it is a decision and the code is
// replaced; from the peer it is only giving up, and the host keeps the code it
// is still handing out to whoever it meant to.
const pairReject = function(ctx) {
    /*{
    }*/
    /*{
        "success": boolean
    }*/
    const server = ctx["server"];
    const sessionId = ctx["sessionId"];

    const pairCode = server.clients.get(sessionId)?.get("pairCode");
    const pair = (pairCode === undefined ? undefined : server.pairs.get(pairCode));
    if (pair !== undefined && pair.get("hostSessionId") === sessionId) {
        rejectRequest(server, pairCode, "rejected");
    } else if (pair !== undefined) {
        removePairCode(server, sessionId);
    }

    // nothing to refuse is not a failure: the request may have run out on its
    // own a moment before the click
    ctx["messageObj"].send({"success": true});
};

// the types this group answers
const handlers = {
    "pair-create": pairCreate,
    "pair-delete": pairDelete,
    "pair-request": pairRequest,
    "pair-accept": pairAccept,
    "pair-reject": pairReject
};

export { handlers, generatePairCode, addPairCode, removePairCode, releasePairCodes, releasePeer, renewHostCode, rejectRequest, push, notify, pairCreate, pairDelete, pairRequest, pairAccept, pairReject, PAIR_CODE_LENGTH, PAIR_CODE_CHARS, PAIR_CODE_PATTERN, PAIR_ANSWER_TIMEOUT };
export default handlers;
