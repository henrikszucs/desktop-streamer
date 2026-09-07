"use strict";

// what the server says on its own, to a socket that is not waiting for an
// answer. Both flows that ask a person something - the pairing of two devices
// and the return of a remembered one - talk to a third socket this way, and
// both draw the same clock, so the window to answer in lives here too.

// how long the host has to accept or reject, whichever flow is asking. Both
// clients are told this number - the one waiting draws a bar that runs out, the
// one deciding draws the same bar on the button that happens by itself - so
// neither side is watching a spinner that means nothing. Silence is a rejection.
const ANSWER_TIMEOUT = 5000;

// a client that is already gone is not an error worth failing a call over, so
// this reports rather than throws
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

// and for every socket of one side of a join, since a device may be open in
// more than one window
const notifyAll = function(server, sessionIds, message) {
    for (const sessionId of sessionIds) {
        notify(server, sessionId, {...message});
    }
};

// How long one relayed frame is given to cross. It is not the interaction
// timeout of a call: a frame is split into packets and a big one is a lot of
// them, so the clock has to fit the whole of it rather than the pause between
// two packets - which the communicator polices on its own.
const DATA_TIMEOUT = 60000;

// A frame the server carries rather than a message it composed: it arrived as an
// ArrayBuffer, it leaves as the same one, and the communicator splits it into
// packets at both ends - which is the whole reason the relay has a binary path.
//
// It is *sent*, not invoked: what would be waited for is an answer nobody needs,
// and a stream cannot stop for one per frame.
const pushData = function(server, sessionId, buffer) {
    const client = server.clients.get(sessionId);
    if (client === undefined) {
        return false;
    }
    try {
        client.get("com").send(buffer, [], DATA_TIMEOUT);
        return true;
    } catch (error) {
        console.log("Cannot relay a frame to (" + sessionId + "):", error);
        return false;
    }
};

export { push, notify, notifyAll, pushData, ANSWER_TIMEOUT, DATA_TIMEOUT };
export default { push, notify, notifyAll, pushData, ANSWER_TIMEOUT, DATA_TIMEOUT };
