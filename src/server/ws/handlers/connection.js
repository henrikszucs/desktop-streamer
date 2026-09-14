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

// the types this group answers
const handlers = {
    "ping": ping,
    "session-get": sessionGet
};

export { handlers, ping, sessionGet };
export default handlers;
