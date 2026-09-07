"use strict";

//
// Import dependencies
//
// first-party dependencies
import confHandlers from "./handlers/conf.js";
import connectionHandlers from "./handlers/connection.js";
import pairingHandlers from "./handlers/pairing.js";
import joinHandlers from "./handlers/joins.js";
import roomHandlers, { roomFrame } from "./handlers/rooms.js";

// one group of calls per file under ./handlers - adding a call means a function
// in the group it belongs to, its type in that group's table, and a line here
const GROUPS = [
    confHandlers,
    connectionHandlers,
    pairingHandlers,
    joinHandlers,
    roomHandlers
];

// the groups merged into one type -> handler table. Two groups claiming the same
// type is a mistake worth failing the boot for, since only one of them would run.
const buildHandlers = function(groups) {
    const handlers = new Map();
    for (const group of groups) {
        for (const type of Object.keys(group)) {
            if (handlers.has(type) === true) {
                throw new Error("WS API type served twice: " + type);
            }
            handlers.set(type, group[type]);
        }
    }
    return handlers;
};
const handlers = buildHandlers(GROUPS);

// the answer of a call this server does not serve, an aborted message sends
// nothing back and would leave the caller on its interaction timeout
const reject = function(messageObj, error) {
    /*{
        "success": false,
        "error": string
    }*/
    if (messageObj.isInvoke === true) {
        messageObj.send({
            "success": false,
            "error": error
        });
        return;
    }
    messageObj.abort();
};

// the client facing protocol, every known type answers the caller. A handler is
// given the one ctx object rather than a list of arguments that grows per call.
const handleAPI = async function(messageObj, sessionId, server) {
    // check basic structure
    await messageObj.wait();
    const message = messageObj.data;

    // A binary message is not a call. It is a frame the relay carries, and it
    // has no "type" to dispatch on: a payload the communicator splits into
    // packets cannot also be a JSON object, so the frame says what it is in its
    // own first bytes (see handlers/rooms.js). One route, no answer - the
    // sender is not waiting for one.
    if (message instanceof ArrayBuffer) {
        roomFrame({
            "message": message,
            "messageObj": messageObj,
            "sessionId": sessionId,
            "server": server
        });
        return;
    }
    // null is an object to typeof, and reading a type off it would throw here -
    // which ws.js answers by terminating the socket, where the whole point of
    // this check is to answer "invalid-format" and leave the connection alone
    if (typeof message !== "object" || message === null || typeof message["type"] !== "string") {
        console.log("Invalid message format", message);
        reject(messageObj, "invalid-format");
        return;
    }

    const handler = handlers.get(message["type"]);
    if (typeof handler === "undefined") {
        console.log("Unknown message type", message["type"]);
        reject(messageObj, "unknown-type");
        return;
    }

    await handler({
        "message": message,
        "messageObj": messageObj,
        "sessionId": sessionId,
        "server": server
    });
};

export { handleAPI, reject, handlers };
export default { handleAPI, reject, handlers };
