"use strict";

// the public half of the configuration: what goes into it, and the call that
// hands it out

// the public half of the configuration, answered to "conf-get": the schema
// defaults are repeated here, Ajv runs without "useDefaults"
const buildPublicConf = function(conf, version) {
    const permissions = conf["ws"]["permissions"] ?? {};
    const google = conf["ws"]["auth"]?.["google"];
    const isGoogleAuth = (typeof google?.["clientId"] === "string");
    const isAuth = (isGoogleAuth === true);      // any sign-in at all, Google is the only provider today

    const confPublic = {
        // the live version of this process, the client checks its own against it
        "version": version,
        "webrtc": {
            "iceServers": conf["ws"]["webrtc"]["iceServers"]
        },
        "permissions": {
            "guestAllowShare": permissions["guestAllowShare"] ?? true,
            "guestAllowJoin": permissions["guestAllowJoin"] ?? true,
            "isAuth": isAuth,
            "isGoogleAuth": isGoogleAuth
        }
    };

    // the sign-in providers, the public client id of each and nothing else
    if (typeof conf["ws"]["auth"] === "object") {
        const auth = {};
        if (isGoogleAuth === true) {
            auth["google"] = {
                "clientId": google["clientId"]
            };
        }
        confPublic["auth"] = auth;
    }

    return confPublic;
};

// the first message a client sends - it stays offline until this one answers,
// and it carries the version, so no second call is needed to check it
const confGet = function(ctx) {
    /*{
    }*/
    /*{
        "version": string,
        "webrtc": {"iceServers": string[]},
        "permissions": {"guestAllowShare": boolean, "guestAllowJoin": boolean,
                        "isAuth": boolean, "isGoogleAuth": boolean},
        "auth": {"google": {"clientId": string}}   (only when configured)
    }*/
    ctx["messageObj"].send(ctx["server"].confPublic);
};

// the types this group answers
const handlers = {
    "conf-get": confGet
};

export { handlers, buildPublicConf, confGet };
export default handlers;
