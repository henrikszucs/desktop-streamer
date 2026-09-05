"use strict";

//
// Import dependencies
//
// first-party dependencies
import confHandlers from "./handlers/conf.js";
import connectionHandlers from "./handlers/connection.js";
import pairingHandlers from "./handlers/pairing.js";

// one group of calls per file under ./handlers - adding a call means a function
// in the group it belongs to, its type in that group's table, and a line here
const GROUPS = [
    confHandlers,
    connectionHandlers,
    pairingHandlers
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
    if (typeof message !== "object" || typeof message["type"] !== "string") {
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
