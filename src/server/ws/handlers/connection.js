"use strict";

// what a client may ask about the connection it is already on

// connection test, the answer carries the server time of the answer
const ping = function(ctx) {
    /*{
    }*/
    /*{
        "success": boolean,
        "timestamp": number
    }*/
    ctx["messageObj"].send({
        "success": true,
        "timestamp": Date.now()
    });
};

// session id of this connection
const sessionGet = function(ctx) {
    /*{
    }*/
    /*{
        "success": boolean,
        "sessionId": string
    }*/
    ctx["messageObj"].send({
        "success": true,
        "sessionId": ctx["sessionId"]
    });
};

// version check, a client that does not match the server has to update
const versionCheck = function(ctx) {
    /*{
        "version": string
    }*/
    /*{
        "success": boolean,
        "version": string
    }*/
    const version = ctx["server"].version;
    ctx["messageObj"].send({
        "success": ctx["message"]["version"] === version,
        "version": version
    });
};

// the types this group answers
const handlers = {
    "ping": ping,
    "session-get": sessionGet,
    "version-check": versionCheck
};

export { handlers, ping, sessionGet, versionCheck };
export default handlers;
