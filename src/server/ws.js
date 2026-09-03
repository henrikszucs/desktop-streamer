"use strict";

//
// Import dependencies
//
// internal dependencies
import https from "node:https";

// third-party dependencies
import { WebSocketServer } from "ws";

// first-party dependencies
import Communicator from "./communicator.js";
import { generateId, getVersion } from "./common.js";
import serverHTTP from "./http.js";

// create the WS server, the files are served by the HTTP server
const ServerWS = class {
    wsServer = null;
    wsHttpServer = null;
    version = "";

    // the half of the configuration a client may see, answered to "conf-get"
    confPublic = {};

    // clients store memory variables
    clients = new Map();            // key-sessionId, value-state object of the client

    // utility things
    isClosing = false;
    constructor() {

    };

    // behavior methods
    async start(conf) {
        // Start WebSocket server
        process.stdout.write("Starting WS server...    ");
        if (typeof conf["ws"] !== "object") {
            process.stdout.write("skipped\n");
            return;
        }
        this.isClosing = false;

        // the version every client is checked against
        this.version = await getVersion();

        // what a client is allowed to learn about this server, never key
        // material, SMTP credentials, OAuth secrets or database settings
        this.confPublic = this.buildPublicConf(conf);

        // the WS server is reachable on the HTTP domain when they share a host
        let domain = conf["ws"]["domain"];
        if (typeof conf?.["http"]?.["domain"] === "string") {
            domain = conf["http"]["domain"];
        }

        // Listen WS port
        if (typeof conf["http"] === "object" && conf["http"]["port"] === conf["ws"]["port"]) {
            // the HTTP server already listens here, only add the upgrade
            this.wsServer = new WebSocketServer({
                "server": serverHTTP.httpServer
            });
        } else {
            this.wsHttpServer = https.createServer({
                "key": conf["ws"]["key"],
                "cert": conf["ws"]["cert"]
            }, function(req, res) {
                res.writeHead(200, {
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Content-Length": 0,
                    "Content-Type": "text/plain"
                });
                res.write("");
                res.end();
            });
            await serverHTTP.listen(this.wsHttpServer, conf["ws"]["port"]);
            this.wsServer = new WebSocketServer({
                "server": this.wsHttpServer
            });
        }
        this.wsServer.addListener("connection", (ws) => {
            if (this.isClosing === true) {
                ws.terminate();
            } else {
                this.clientConnect(ws);
            }
        });
        process.stdout.write("\n    Available: wss://" + domain + (conf["ws"]["port"] !== 443 ? ":" + conf["ws"]["port"] : "") + "\n");
        process.stdout.write("done\n");
    };

    // the public half of the configuration, the answer of "conf-get". The
    // permission defaults repeat the ones in the schema, which are documentation
    // only - Ajv runs without "useDefaults", so a missing key arrives undefined.
    //
    // "permissions" is what this server would let the caller do, so the client
    // can leave a feature it is going to refuse off the screen rather than fail
    // it at the point of use. Every flag in it is answered for every client, set
    // or not, so the client never has to know a default of its own.
    //
    // isAuth and isGoogleAuth are the same question asked about sign-in, one
    // step apart: isAuth is whether this server has any way to sign in at all,
    // which is what the shell asks before it offers to add an account, and
    // isGoogleAuth is whether that one provider is there, which is what deciding
    // to show its button needs. "auth" below is what building the button needs.
    // Every one of them is read off the same key, so a provider cannot be
    // announced and then be missing its client id, and isAuth cannot be true
    // with nothing behind it - today Google is the only provider, so the two
    // flags agree and a second one would only widen isAuth.
    //
    // With no "auth" section there is no sign-in: isAuth is false, the auth
    // section is left off the answer, every client stays a guest, and the whole
    // auth half of the configuration - the userRegister policy included -
    // decides nothing.
    //
    // When "auth" is absent there is no sign-in at all: isGoogleAuth is false,
    // the auth section is left off and every client stays a guest, so the whole
    // auth half of the configuration - the userRegister policy included - has
    // nothing to decide.
    //
    // The permissions the schema carries and this does not are the ones the
    // client has no say in: guestAllowRelay is enforced on the relay itself,
    // userRegister is enforced at sign-in (the client cannot know whether the
    // account behind a credential exists yet), and userRegisterRelay is a
    // registration policy that decides nothing on screen.
    buildPublicConf(conf) {
        const permissions = conf["ws"]["permissions"] ?? {};
        const google = conf["ws"]["auth"]?.["google"];
        const isGoogleAuth = (typeof google?.["clientId"] === "string");
        const isAuth = (isGoogleAuth === true);

        const confPublic = {
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

    // a session id that no live connection holds
    generateSessionId() {
        let sessionId = undefined;
        while (sessionId === undefined) {
            sessionId = generateId(10);
            if (this.clients.has(sessionId) === true) {
                sessionId = undefined;
            }
        }
        return sessionId;
    };

    async clientConnect(ws) {
        // generate the session id of the connection
        const sessionId = this.generateSessionId();

        // create communicator
        const com = new Communicator({
            "sender": async function(data, transfer, message) {
                if ((data instanceof ArrayBuffer) === false) {
                    data = JSON.stringify(data);
                }
                ws.send(data);
            },
            "interactTimeout": 3000,
            "timeout": 5000,
            "packetSize": 1000,
            "packetTimeout": 1000,
            "packetRetry": Infinity,
            "sendThreads": 16
        });

        // create state, the session id is taken before the first await
        /*{
            "com": Communicator,
            "ws": WebSocket
        }*/
        const client = new Map([
            ["com", com],
            ["ws", ws]
        ]);
        this.clients.set(sessionId, client);

        // listen messages
        ws.addEventListener("message", function(event) {
            let data = event.data;  // can be string or ArrayBuffer
            try {
                if (typeof data === "string") {
                    data = JSON.parse(data);
                } else {
                    data = new Uint8Array(data);
                    data = data.buffer;
                }
            } catch (error) {
                console.log(error);
                return;
            }
            com.receive(data);
        });

        // listen error
        ws.addEventListener("error", (event) => {
            console.log("Error " + event.error);
        });

        // listen close
        ws.addEventListener("close", () => {
            // clean up
            const client = this.clients.get(sessionId);
            if (client === undefined) {
                return;     // a second close event after the cleanup
            }
            client.get("com").release();
            this.clients.delete(sessionId);

            console.log("Client disconnected (" + sessionId + ")");
        });

        // listen messages and handle API
        com.onIncoming(async (messageObj) => {
            try {
                await this.handleAPI(messageObj, sessionId);
            } catch (error) {
                console.log("Error handling message:", error);
                client.get("ws").terminate();
            }
        });

        // sync the two sides of the communicator
        await com.sideSync();
        await com.timeSync();

        // debug info
        console.log("Client connected (" + sessionId + ")");
    };

    // the client facing protocol, every known message type answers the caller
    async handleAPI(messageObj, sessionId) {
        // check basic structure
        await messageObj.wait();
        const message = messageObj.data;
        if (typeof message !== "object" || typeof message["type"] !== "string") {
            console.log("Invalid message format", message);
            this.reject(messageObj, "invalid-format");
            return;
        }

        // the public half of the server configuration, the first message a
        // client sends - it stays offline until this one answers
        if (message["type"] === "conf-get") {
            /*{
            }*/
            /*{
                "webrtc": {"iceServers": string[]},
                "permissions": {"guestAllowShare": boolean, "guestAllowJoin": boolean,
                                "isAuth": boolean, "isGoogleAuth": boolean},
                "auth": {"google": {"clientId": string}}   (only when configured)
            }*/
            messageObj.send(this.confPublic);
            return;
        }

        // connection test, the answer carries the server time of the answer
        if (message["type"] === "ping") {
            /*{
            }*/
            /*{
                "success": boolean,
                "timestamp": number
            }*/
            messageObj.send({
                "success": true,
                "timestamp": Date.now()
            });
            return;
        }

        // session id of this connection
        if (message["type"] === "session-get") {
            /*{
            }*/
            /*{
                "success": boolean,
                "sessionId": string
            }*/
            messageObj.send({
                "success": true,
                "sessionId": sessionId
            });
            return;
        }

        // version check, a client that does not match the server has to update
        if (message["type"] === "version-check") {
            /*{
                "version": string
            }*/
            /*{
                "success": boolean,
                "version": string
            }*/
            messageObj.send({
                "success": message["version"] === this.version,
                "version": this.version
            });
            return;
        }

        console.log("Unknown message type", message["type"]);
        this.reject(messageObj, "unknown-type");
    };

    // the answer of a call this server does not serve. An aborted incoming
    // message sends nothing back, so the caller would sit out its whole
    // interaction timeout instead of failing on the spot - answer every invoke.
    reject(messageObj, error) {
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

    async stop() {
        this.isClosing = true;

        process.stdout.write("\n    Closing WS server....    ");
        if (this.wsServer !== null) {
            // close WS server and its connections
            await new Promise((resolve) => {
                let round = 0;
                const close = () => {
                    if (round === 0) {
                        // First sweep, soft close
                        this.wsServer.clients.forEach(function (socket) {
                            socket.close();
                        });
                    } else if (round < 20) {
                        // Check clients
                        let isAllClosed = true;
                        for (const socket of this.wsServer.clients) {
                            if ([socket.OPEN, socket.CLOSING].includes(socket.readyState)) {
                                isAllClosed = false;
                                break;
                            }
                        }
                        if (isAllClosed === true) {
                            resolve(true);
                            return;
                        }
                    } else {
                        // Last sweep, hard close for everyone who's left
                        this.wsServer.clients.forEach(function(socket) {
                            if ([socket.OPEN, socket.CLOSING].includes(socket.readyState)) {
                                socket.terminate();
                            }
                        });
                        resolve(true);
                        return;
                    }
                    round++;
                    setTimeout(close, 500);
                };
                close();

            });

            // close WS HTTP server if exists
            if (this.wsHttpServer !== null) {
                await new Promise((resolve) => {
                    const timeOut = setTimeout(function() {
                        resolve(false);
                    }, 5000);
                    this.wsHttpServer.close(function() {
                        clearTimeout(timeOut);
                        resolve(true);
                    });
                });
                this.wsHttpServer = null;
            }
            this.wsServer = null;
            process.stdout.write("done\n");
        } else {
            process.stdout.write("skipped\n");
        }

        // drop the connection state
        this.clients.clear();
    };
};

// the server is a singleton, the module hands out the running instance
const serverWS = new ServerWS();

export { serverWS };
export default serverWS;
