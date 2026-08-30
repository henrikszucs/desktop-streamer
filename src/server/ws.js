"use strict";


// temporary class
// create HTTP/WS servers
const Server = class {
    httpBasePath = "./src/client/web";
    httpDownloadPath = "./tmp";
    httpServer = null;
    httpCache = new Map();
    httpCacheSize = 0;
    httpCacheSizeLimit = 0;
    httpCacheUpdate = 1000;
    httpCacheUpdateLength = 5;
    httpCacheUpdateId = -1;
    httpCacheReloadId = -1;
    httpRedirect = null;

    wsServer = null;
    wsHttpServer = null;
    mailers = [];
    clientConf = {};
    authGoogle = null;
    domain = "";

    // clients store memory variables
    clients = new Map();            // key-clientId, value-state object of the client
    sessions = new Map();           // key-sessionId, value-set of clientIds
    subscriptions = new Map([
        ["email", new Map()],
        ["firstName", new Map()],
        ["lastName", new Map()],
        ["picture", new Map()],
        ["sessions", new Map()],
        ["devices", new Map()],
        ["shares", new Map()]
    ]);                             // key-subscription name, value-> Map of "userId" -> Set of "clientId"
    pairs = new Map();              // key-pairCode, value-> {hostClientId, peerClientId, timeoutId}
    joins = new Map();              // key-joinId, value-> {peerCode, hostCode, peerUserId, hostUserId, peerName, hostName, isRemember, peerClientIds, hostClientIds}
    joinsUser = new Map();          // key-userId, value-> Set of joinIds           for indexing

    // utility things
    isClosing = false;
    constructor() {

    };

    async getFileData(src) {
        try {
            const data = await fs.readFile(src);
            const stats = await fs.stat(src);
            const date = new Date(stats.mtimeMs);
            return {
                "lastModified": date.toUTCString(),
                "type": Mime.getMIMEType(path.extname(src)) || "text/plain",
                "size": stats.size,
                "etag": path.basename(src) + String(stats.size),
                "buffer": data
            };
        } catch (error) {
            return undefined;
        }
        
    };
    async getFileDataStream(src) {
        try {
            const stats = await fs.stat(src);
            if (stats.isFile() === false) {
                return undefined;
            }

            const data = await fs.open(src);
            const date = new Date(stats.mtimeMs);
            const stream = data.createReadStream();

            //close if end or inactive
            let timeOut = -1;
            stream.on("data", function() {
                //console.log("read");
                clearTimeout(timeOut);
                timeOut = setTimeout(function() {
                    data?.close?.();
                }, 10000);
            });
            stream.on("end", function() {
                //console.log("end");
                clearTimeout(timeOut);
                data?.close?.();
            });
            
            return {
                "lastModified": date.toUTCString(),
                "type": Mime.getMIMEType(path.extname(src)) || "text/plain",
                "size": stats.size,
                "etag": path.basename(src) + String(stats.size),
                "stream": stream
            };
        } catch (error) {
            return undefined;
        }
    };

    async httpsGetText(url) {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                const statusCode = res.statusCode;

                if (statusCode !== 200) {
                    const error = new Error("Request Failed.\n" + `Status Code: ${statusCode}`);
                    //console.error(error.message);
                    // Consume response data to free up memory
                    res.resume();
                    reject(error);
                    return;
                }

                let rawData = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => {
                    rawData += chunk;
                });
                res.on("end", () => {
                    resolve(rawData);
                });
            }).on("error", (error) => {
                console.error(`Got error: ${error.message}`);
                reject(error);
            });
        });
    };
    async httpsGetImage(url) {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                const statusCode = res.statusCode;
                const contentType = res.headers["content-type"];

                if (statusCode !== 200) {
                    const error = new Error("Request Failed.\n" + `Status Code: ${statusCode}`);
                    //console.error(error.message);
                    // Consume response data to free up memory
                    res.resume();
                    reject(error);
                    return;
                }

                let rawData = "";
                res.setEncoding("base64");
                res.on("data", (chunk) => {
                    rawData += chunk;
                });
                res.on("end", () => {
                    const data = "data:" + contentType + ";base64," + rawData;
                    resolve(data);
                });
            }).on("error", (error) => {
                console.error(`Got error: ${error.message}`);
                reject(error);
            });
        });
    };

    // behavior methods
    async start(conf) {
        process.stdout.write("Starting HTTP server...    ");
        // Start HTTP server
        if (typeof conf["http"] === "object") {
            const basePaths = [this.httpBasePath, this.httpDownloadPath];

            // create configuration file
            const files = await fs.readdir(this.httpDownloadPath);
            const confData = {
                "http": {
                    "clients": [...files],
                    "version": CLIENT_VERSION
                },
                "ws": {}
            };
            if (typeof conf["http"]["remote"] === "object") {
                confData["ws"]["domain"] = conf["http"]["remote"]["host"];
                confData["ws"]["port"] = conf["http"]["remote"]["port"];
            } else {
                confData["ws"]["domain"] = conf["http"]["domain"];
                confData["ws"]["port"] = conf["ws"]["port"];
            }
            let confScript = "\"use strict\";";
            confScript += "\n" + "export default " + JSON.stringify(confData) + ";";
            await fs.writeFile(path.join(this.httpBasePath, "conf.js"), confScript);
            await fs.writeFile(path.join(this.httpBasePath, "version"), CLIENT_VERSION);

            // create HTTP server request handler
            let requestHandle = null;
            if (typeof conf["http"]["cache"] !== "object") {
                requestHandle = async (req, res) => {
                    const filePath = req.url.slice(1);          // remove start slash

                    // get requested file
                    let fileData;
                    for (const basePath of basePaths) {
                        const fullPath = path.join(basePath, filePath);
                        fileData = await this.getFileDataStream(fullPath); 
                        if (typeof fileData !== "undefined") {
                            break; // found
                        }
                    }
                    // get default file if not found
                    if (typeof fileData === "undefined") {
                        fileData = await this.getFileDataStream(path.join(basePaths[0], "index.html")); 
                    }
                    res.writeHead(200, {
                        //"Content-Security-Policy": "connect-src https://accounts.google.com/gsi/",
                        "Cache-Control": "no-cache, no-store, must-revalidate",
                        "Last-Modified": fileData["lastModified"],
                        "Content-Length": fileData["size"],
                        "Content-Type": fileData["type"],
                        "ETag": fileData["etag"]
                    });
                    fileData["stream"].pipe(res);
                };
            } else {
                // build cache
                this.httpCache = new Map();
                for (const basePath of basePaths.reverse()) {
                    const files = await fs.readdir(basePath, {"recursive": true});
                    for (const file of files) {
                        const src = path.join(basePath, file);
                        const stats = await fs.stat(src);
                        const date = new Date(stats.mtimeMs);
                        this.httpCache.set(file, {
                            "path": src,
                            "lastModified": date.toUTCString(),
                            "type": Mime.getMIMEType(path.extname(src)),
                            "size": stats.size,
                            "etag": path.basename(src) + String(stats.size),
                            "accesses": new Array(this.httpCacheUpdateLength*2).fill(0),
                            "accessed": 0,
                        });
                    }
                }

                // update access stats periodically
                this.httpCacheSize = conf["http"]["cache"]["size"];
                clearInterval(this.httpCacheUpdateId);
                this.httpCacheUpdateId = setInterval(() => {
                    const it = this.httpCache.entries();
                    for (const [key, fileData] of it) {
                        fileData["accessed"] -= fileData["accesses"].pop();
                        fileData["accesses"].unshift(0);
                    }
                }, this.httpCacheUpdate);

                // reload cache periodically
                clearInterval(this.httpCacheReloadId);
                this.httpCacheReloadId = setInterval(async () => {
                    // fill with priority order small -> high (smaller is better)
                    const priorityOrder = [];
                    const it = this.httpCache.entries();
                    for (const [key, val] of it) {
                        if (typeof val["size"] > this.httpCacheSizeLimit) {
                            continue; // skip too big files
                        }
                        const el = {
                            "file": key,
                            "priority": -(val["accessed"] / Math.max(val["size"], 1))
                        };
                        const [isFound, i] = binarySearch(priorityOrder, el["priority"], function(el) {return el["priority"]});
                        priorityOrder.splice(i, 0, el);
                    }

                    // search for last cached file
                    const length = priorityOrder.length;
                    let currentSize = 0;
                    let currentIndex = 0;
                    while (currentIndex < length && currentSize < this.httpCacheSize && priorityOrder[currentIndex]["priority"] < 0) {
                        currentSize += this.httpCache.get(priorityOrder[currentIndex]["file"])["size"];
                        currentIndex++;
                    }
                    //console.log(currentSize);
                    //console.log(currentIndex);
                    
                    // remove unused files
                    for (let i = currentIndex; i < length; i++) {
                        const fileData = this.httpCache.get(priorityOrder[i]["file"]);
                        delete fileData["buffer"]; // remove buffer to save memory
                    }

                    // add files to cache
                    for (let i = 0; i < currentIndex; i++) {
                        const fileData = this.httpCache.get(priorityOrder[i]["file"]);
                        if (typeof fileData["buffer"] === "undefined") {
                            fileData["buffer"] = (await this.getFileData(fileData["path"]))["buffer"];
                        }
                    }

                    //console.log(priorityOrder);
                    //console.log(this.httpCache.get("index.html"));
                }, this.httpCacheUpdate * this.httpCacheUpdateLength);

                requestHandle = async (req, res) => {
                    let filePath = req.url.slice(1);          // remove start slash

                    // check existence of file
                    let fileData = this.httpCache.get(filePath);
                    if (typeof fileData === "undefined") {
                        fileData = this.httpCache.get("index.html");
                    }

                    // add access to statistics
                    fileData["accesses"][0] += 1;
                    fileData["accessed"] += 1;

                    // check if file is in memory cache
                    res.writeHead(200, {
                        //"Content-Security-Policy": "default-src 'self'",
                        "Last-Modified": fileData["lastModified"],
                        "Content-Length": fileData["size"],
                        "Content-Type": fileData["type"]
                    });
                    if (typeof fileData["buffer"] !== "undefined") {
                        res.write(fileData["buffer"]);
                        res.end();
                    } else {
                        const file = await this.getFileDataStream(fileData["path"]);
                       file["stream"].pipe(res);
                    }
                };
            }
            this.httpServer = https.createServer({
                "key": conf["http"]["key"],
                "cert": conf["http"]["cert"]
            }, requestHandle);
            this.httpServer.listen(conf["http"]["port"]);
            process.stdout.write("\n    Available: https://" + conf["http"]["domain"] + (conf["http"]["port"] !== 443 ? ":" + conf["http"]["port"] : "") + "\n");

            // create redirect server
            if (typeof conf["http"]["redirect"] !== "undefined") {
                const redirectHandle = function(req, res) {
                    const myURL = req.headers.host.split(":")[0];
                    const myPort = conf["http"]["port"] !== 443 ? ":" + conf["http"]["port"] : "";
                    res.writeHead(302, {
                        "Location": "https://" + myURL + myPort + req.url
                    });
                    res.end();
                };
                this.httpRedirect = http.createServer(redirectHandle);
                this.httpRedirect.listen(conf["http"]["redirect"]);
                process.stdout.write("    Redirect: http://" + conf["http"]["domain"] + (conf["http"]["redirect"] !== 80 ? ":" + conf["http"]["port"] : "") + "\n");
            }
            process.stdout.write("done\n");

        } else {
            process.stdout.write("skipped\n");
        }

        // Start WebSocket server
        process.stdout.write("Starting WS server...    ");
        if (typeof conf["ws"] === "object") {
            // copy domain data
            if (typeof conf["http"]["domain"] === "string") {
                this.domain = conf["http"]["domain"];
            } else {
                this.domain = conf["ws"]["domain"];
            }

            // Connect to mail servers
            for (const smtp of conf["ws"]["emails"]) {
                if (smtp["auth"]["type"] === "password") {
                    const transporter = nodemailer.createTransport({
                        "host": smtp["host"],
                        "port": smtp["port"],
                        "secure": true,
                        "auth": {
                            "user": smtp["user"],
                            "pass": smtp["auth"]["pass"]
                        }
                    });
                    const res = await transporter.verify();
                    if (res === false) {
                        throw new Error("Cannot authenticate WS SMTP with provided configuration: " + JSON.stringify(smtp));
                    }
                    this.mailers.push(transporter);
                } else if (smtp["auth"]["type"] === "OAuth2") {
                    const transporter = nodemailer.createTransport({
                        "host": smtp["host"],
                        "port": smtp["port"],
                        "secure": true,
                        "auth": {
                            "type": "OAuth2",
                            "user": smtp["user"],
                            "clientId": smtp["auth"]["clientId"],
                            "clientSecret": smtp["auth"]["clientSecret"],
                            "refreshToken": smtp["auth"]["refreshToken"]
                        }
                    });
                    const res = await transporter.verify();
                    if (res === false) {
                        throw new Error("Cannot authenticate WS SMTP with provided configuration: " + JSON.stringify(smtp));
                    }
                    this.mailers.push(transporter);
                }
            }
            if (this.mailers.length === 0) {
                throw new Error("At least one WS email SMTP server must be configured!");
            }

            // Database connect
            try {
                this.db = knex({
                    "client": conf["ws"]["database"]["type"],
                    "connection": {
                        "host": conf["ws"]["database"]["host"],
                        "port": conf["ws"]["database"]["port"],
                        "user": conf["ws"]["database"]["user"],
                        "password": conf["ws"]["database"]["pass"],
                        "database": conf["ws"]["database"]["db"]
                    },
                });
            } catch (error) {
                throw new Error("Cannot connect to WS Database with provided configuration: " + error.message);
            }

            // Create db schema
            if (await this.db.schema.hasTable("users") === false) {
                await this.db.schema.createTable("users", function (table) {
                    table.string("user_id");
                    table.text("email");
                    table.text("first_name");
                    table.text("last_name");
                });
                await this.db.schema.alterTable("users", function (table) {
                    table.primary("user_id");
                    table.unique("email");
                });
            }
            if (await this.db.schema.hasTable("users_google") === false) {
                await this.db.schema.createTable("users_google", function (table) {
                    table.string("sub");
                    table.string("user_id");
                    table.text("picture");
                });
                await this.db.schema.alterTable("users_google", function (table) {
                    table.primary("sub");
                    table.foreign("user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }
            if (await this.db.schema.hasTable("sessions") === false) {
                await this.db.schema.createTable("sessions", function (table) {
                    table.string("session_id");
                    table.string("user_id");
                    table.string("session_key");
                    table.bigint("expire").unsigned();
                    table.bigint("last_used").unsigned();
                    table.text("ip_address");
                    table.text("user_agent");
                });
                await this.db.schema.alterTable("sessions", function (table) {
                    table.primary("session_id");
                    table.foreign("user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                    table.unique("session_key");
                });
            }
            if (await this.db.schema.hasTable("delete") === false) {
                await this.db.schema.createTable("delete", function (table) {
                    table.string("delete_id");
                    table.string("user_id");
                    table.string("delete_key");
                    table.bigint("expire").unsigned();
                });
                await this.db.schema.alterTable("delete", function (table) {
                    table.primary("delete_id");
                    table.foreign("user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                    table.unique("delete_key");
                });
            }
            if (await this.db.schema.hasTable("joins") === false) {
                await this.db.schema.createTable("joins", function (table) {
                    table.string("join_id");
                    table.string("peer_code");
                    table.string("host_code");
                    table.string("peer_user_id");
                    table.string("host_user_id");
                    table.string("peer_name");
                    table.string("host_name");
                    
                });
                await this.db.schema.alterTable("joins", function (table) {
                    table.primary("join_id");
                    table.foreign("peer_user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                    table.foreign("host_user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }
           

            // Configure auth methods
            if (typeof conf["ws"]["features"]["auth"]["google"] !== "undefined") {
                this.authGoogle = async (credential) => {
                    let userInfo = undefined;
                    try {
                        const res = await this.httpsGetText("https://oauth2.googleapis.com/tokeninfo?id_token=" + credential);
                        userInfo = JSON.parse(res);
                        if (userInfo["aud"] !== conf["ws"]["features"]["auth"]["google"]["clientId"]) {
                            throw new Error("Invalid Google OAuth2 client ID");
                        }
                        if (userInfo["email_verified"] !== "true") {
                            throw new Error("Google OAuth2 email not verified");
                        }
                        if (userInfo["exp"] < Date.now() / 1000) {
                            throw new Error("Google OAuth2 token expired");
                        }
                    } catch (error) {
                        console.log(error);
                        return undefined;
                    }
                    return userInfo;
                };
            } else {
                this.authGoogle = (credential) => {
                    return undefined;
                };
            }

            // Setup public configuration for client
            this.clientConf = {
                "webrtc": {
                    "iceServers": [...conf["ws"]["webrtc"]["iceServers"]]
                },
                "screenSharing": {
                    "isHomePage": conf["ws"]["features"]["screenSharing"]["isHomePage"],
                    "allowGuestShare": conf["ws"]["features"]["screenSharing"]["allowGuestShare"],
                    "allowGuestJoin": conf["ws"]["features"]["screenSharing"]["allowGuestJoin"]
                },
                "auth": {}
            };
            if (typeof conf["ws"]["features"]["serviceSharing"] !== "undefined") {
                this.clientConf["serviceSharing"] = {
                };
                if (typeof conf["ws"]["features"]["serviceSharing"]["isHomePage"] === "boolean") {
                    this.clientConf["serviceSharing"]["isHomePage"] = conf["ws"]["features"]["serviceSharing"]["isHomePage"];
                } else {
                    this.clientConf["serviceSharing"]["isHomePage"] = false;
                }
            }
            if (typeof conf["ws"]["features"]["auth"]["google"] !== "undefined") {
                this.clientConf["auth"]["google"] = {};
                this.clientConf["auth"]["google"]["clientId"] = conf["ws"]["features"]["auth"]["google"]["clientId"];
            }

            // Listen WS port
            if (conf["ws"]["port"] === conf?.["http"]?.["port"]) {
                this.wsServer = new WebSocketServer({
                    "server": this.httpServer
                });
            } else {
                this.wsHttpServer = https.createServer({
                    "key": conf["ws"]["key"],
                    "cert": conf["ws"]["cert"]
                }, function (req, res) {
                    res.writeHead(200, {
                        //"Content-Security-Policy": "default-src 'self'",
                        "Cache-Control": "no-cache, no-store, must-revalidate",
                        "Content-Length": 0,
                        "Content-Type": "text/plain"
                    });
                    res.write("");
                    res.end();
                });
                this.wsHttpServer.listen(conf["ws"]["port"]);
                this.wsServer = new WebSocketServer({
                    "server": this.wsHttpServer
                });
            }
            this.wsServer.addListener("connection", (ws) => {
                if (this.isClosing) {
                    ws.terminate();
                } else {
                    this.clientConnect(ws);
                }
            });
            process.stdout.write("done\n");
        } else {
            process.stdout.write("skipped\n");
        }

    };

    async addSession(userId, ipAddress, userAgent) {
        // create in db
        let sessionId = undefined;
        while (sessionId === undefined) {
            sessionId = generateId(10);
            const existing = await this.db.select().table("sessions").where("session_id", sessionId).first();
            if (existing !== undefined) {
                sessionId = undefined;
            }
        }
        let sessionKey = undefined;
        while (sessionKey === undefined) {
            sessionKey = generateId(10);
            const existing = await this.db.select().table("sessions").where("session_key", sessionKey).first();
            if (existing !== undefined) {
                sessionKey = undefined;
            }
        }
        const expire = Date.now() + 7 * 24 * 60 * 60 * 1000;
        const lastUsed = Date.now();
        await this.db.insert({
            "session_id": sessionId,
            "user_id": userId,
            "session_key": sessionKey,
            "expire": expire,
            "last_used": lastUsed,
            "ip_address": ipAddress,
            "user_agent": userAgent
        }).into("sessions");

        // notify subscribed clients (same userId) about new session
        const sessionsSubscription = this.subscriptions.get("sessions").get(userId);
        if (sessionsSubscription !== undefined) {
            for (const subClientId of sessionsSubscription) {
                const com = this.clients.get(subClientId).get("com");
                com.send({
                    "timestamp": Date.now(),
                    "type": "sessions",
                    "value": {
                        "sessionId": sessionId,
                        "lastUsed": lastUsed,
                        "ipAddress": ipAddress,
                        "userAgent": userAgent
                    }
                });
            }
        }

        // return session info
        return {"sessionId": sessionId, "sessionKey": sessionKey};
    };
    async updateSession(userId, sessionId, expire, lastUsed, ipAddress, userAgent) {
        // check if session exists
        const session = await this.db.select()
            .table("sessions")
            .where("session_id", sessionId)
            .andWhere("user_id", userId)
            .andWhere("expire", ">", Date.now())
            .first();

        if (session === undefined) {
            return undefined;
        }

        // update in db
        let isChanged = false;
        const change = {
            "sessionId": sessionId
        };
        if (expire !== undefined) {
            await this.db("sessions")
                .where({"session_id": sessionId})
                .andWhereNot({"expire": expire})
                .update({"expire": expire});
            // skip notification for expire change
        }

        if (lastUsed !== undefined) {
            const update = await this.db("sessions")
                .where({"session_id": sessionId})
                .andWhereNot({"last_used": lastUsed})
                .update({"last_used": lastUsed});
            if (update !== 0) {
                isChanged = true;
                change["lastUsed"] = lastUsed;
            }
        }

        if (ipAddress !== undefined) {
            const update = await this.db("sessions")
                .where({"session_id": sessionId})
                .andWhereNot({"ip_address": ipAddress})
                .update({"ip_address": ipAddress});
            if (update !== 0) {
                isChanged = true;
                change["ipAddress"] = ipAddress;
            }
        }

        if (userAgent !== undefined) {
            const update = await this.db("sessions")
                .where({"session_id": sessionId})
                .andWhereNot({"user_agent": userAgent})
                .update({"user_agent": userAgent});
            if (update !== 0) {
                isChanged = true;
                change["userAgent"] = userAgent;
            }
        }

        // broadcast to subscribed clients if changed
        if (isChanged === true) {
            const sessionsSubscription = this.subscriptions.get("sessions").get(userId);
            if (sessionsSubscription !== undefined) {
                for (const subClientId of sessionsSubscription) {
                    const com = this.clients.get(subClientId).get("com");
                    com.send({
                        "timestamp": Date.now(),
                        "type": "sessions",
                        "isChange": true,
                        "value": change
                    });
                }
            }
        }

        return isChanged;
    };
    async removeSession(userId, sessionId) {
        // delete from db
        await this.db("sessions").where({"session_id": sessionId}).delete();

        // remove all clients from session 
        const clients = this.sessions.get(sessionId);
        if (clients !== undefined) {
            // notify clients about logout
            for (const clientId of clients) {
                const com = this.clients.get(clientId).get("com");
                com.send({
                    "timestamp": Date.now(),
                    "type": "logout"
                });
            }

            // update internal state of clients
            for (const clientId of clients) {
                this.removeClientSession(userId, sessionId, clientId);
            }
        }

        // notify other subscribed clients (same userId) about removed session
        const sessionsSubscription = this.subscriptions.get("sessions").get(userId);
        if (sessionsSubscription !== undefined) {
            for (const subClientId of sessionsSubscription) {
                const com = this.clients.get(subClientId).get("com");
                com.send({
                    "timestamp": Date.now(),
                    "type": "sessions",
                    "isRemove": true,
                    "value": sessionId
                });
            }
        }

    };

    addClientSession(userId, sessionId, clientId) {
        // add session to sessions map
        const clientsSet = this.sessions.get(sessionId);
        if (clientsSet === undefined) {
            this.sessions.set(sessionId, new Set([clientId]));
        } else {
            clientsSet.add(clientId);
        }

        // update state
        const client = this.clients.get(clientId);
        client.set("isLoggedIn", true);
        client.set("userId", userId);
        client.set("sessionId", sessionId);
        client.set("joinIds", new Set());

        // remove pair code
        this.removePairCode(clientId, false, true);
    };
    removeClientSession(userId, sessionId, clientId) {
        const client = this.clients.get(clientId);

        // remove from sessions map
        const clientsSet = this.sessions.get(sessionId);
        if (clientsSet !== undefined) {
            clientsSet.delete(clientId);
            if (clientsSet.size === 0) {
                this.sessions.delete(sessionId);
            }
        }

        // remove joins
        const joinIds = client.get("joinIds");
        for (const joinId of joinIds) {
            const join = this.joins.get(joinId);
            if (join.get("peerClientIds").has(clientId) === true && join.get("peerUserId") === userId) {
                this.removeClientJoin(joinId, clientId, undefined, true);
                client.get("joinIds").delete(joinId);
            } else if (join.get("hostClientIds").has(clientId) === true && join.get("hostUserId") === userId) {
                this.removeClientJoin(joinId, undefined, clientId, true);
                client.get("joinIds").delete(joinId);
            }
        }
        
        // remove subscriptions
        const it = this.subscriptions.entries();
        for (const [type, subsMap] of it) {
            this.removeClientSubscription(type, userId, clientId);
        }

        // update client state
        client.set("isLoggedIn", false);
        client.delete("userId");
        client.delete("sessionId");
        client.delete("sessionKey");

        // remove pair code
        this.removePairCode(clientId, false, true);
    };

    addClientSubscription(type, userId, clientId) {
        const subscriptions = this.subscriptions.get(type);
        const userSubscriptions = subscriptions.get(userId);
        if (userSubscriptions === undefined) {
            subscriptions.set(userId, new Set([clientId]));
        } else {
            userSubscriptions.add(clientId);
        }
    };
    removeClientSubscription(type, userId, clientId) {
        const subscriptions = this.subscriptions.get(type);
        const userSubscriptions = subscriptions.get(userId);
        if (userSubscriptions !== undefined) {
            userSubscriptions.delete(clientId);
            if (userSubscriptions.size === 0) {
                subscriptions.delete(userId);
            }
        }
        if (type === "devices") {
            // remove all joins related to devices
            const client = this.clients.get(clientId);
            const joinsUser = this.joinsUser.get(client.get("userId"));
            console.log(client.get("userId"));
            console.log(joinsUser);
            if (joinsUser !== undefined) {
                for (const joinId of joinsUser) {
                    this.removeClientJoin(joinId, undefined, undefined, false);
                }
            }
        }
    };

    addPairCode(clientId) {
        let pairCode = undefined;
        while (pairCode === undefined) {
            pairCode = generateId(6, "0123456789");
            if (this.pairs.has(pairCode) === true) {
                pairCode = undefined;
            }
        }

        // create pair entry
        const initState = new Map([
            ["hostClientId", clientId]
        ]);
        this.pairs.set(pairCode, initState);

        // update client state (for backward lookup)
        this.clients.get(clientId).set("pairCode", pairCode);

        return pairCode;
    };
    removePairCode(clientId, notifySelf=false, notifyOther=false) {
        // check pair code
        const client = this.clients.get(clientId);
        const pairCode = client.get("pairCode");
        if (pairCode === undefined) {
            return;
        }
        const pair = this.pairs.get(pairCode);

        // remove timeout
        clearTimeout(pair.get("timeoutId"));
        pair.set("timeoutId", -1);

        //notify clients
        const hostClientId = pair.get("hostClientId");
        const peerClientId = pair.get("peerClientId");
        if ((notifySelf === true && hostClientId === clientId) || (notifyOther === true && hostClientId !== clientId)) {
            const hostClient = this.clients.get(hostClientId);
            hostClient.get("com").send({
                "timestamp": Date.now(),
                "type": "pair-reject",
            });
        }
        if (peerClientId !== undefined) {
            if (notifySelf === true && peerClientId === clientId || (notifyOther === true && peerClientId !== clientId)) {
                const peerClient = this.clients.get(peerClientId);
                peerClient.get("com").send({
                    "timestamp": Date.now(),
                    "type": "pair-reject",
                });
            }
        }

        // remove data
        if (hostClientId === clientId) {
            // delete host
            const hostClient = this.clients.get(hostClientId);
            hostClient.delete("pairCode");
            //delete peer
            const peerClient = this.clients.get(peerClientId);
            if (peerClient !== undefined) {
                peerClient.delete("pairCode");
            }
            //delete pair
            this.pairs.delete(pairCode);
        } else {
            // delete peer
            const peerClient = this.clients.get(peerClientId);
            peerClient.delete("pairCode");
            //delete pair peer side
            pair.delete("peerClientId");
        }
    };
    
    async broadcastJoin(joinId, msg, containDevices, containShares, containPeers, containHost, callerClientId) {
        const clientIdSet = new Set();
        const join = this.joins.get(joinId);

        // add "devices"
        if (containDevices === true) {
            const peerUserId = join.get("peerUserId");
            const joinSubscription = this.subscriptions.get("devices").get(peerUserId);
            if (joinSubscription !== undefined) {
                for (const subClientId of joinSubscription) {
                    clientIdSet.add(subClientId);
                }
            }
        }

        // add "shares"
        if (containShares === true) {
            const hostUserId = join.get("hostUserId");
            const joinSubscription = this.subscriptions.get("shares").get(hostUserId);
            if (joinSubscription !== undefined) {
                for (const subClientId of joinSubscription) {
                    clientIdSet.add(subClientId);
                }
            }
        }

        // add peer clients
        if (containPeers === true) {
            const peerClientIds = join.get("peerClientIds");
            for (const peerClientId of peerClientIds) {
                clientIdSet.add(peerClientId);
            }
        }

        // add host clients
        if (containHost === true) {
            const hostClientIds = join.get("hostClientIds");
            for (const hostClientId of hostClientIds) {
                clientIdSet.add(hostClientId);
            }
        }

        // send message to clients
        const pendings = [];
        clientIdSet.delete(callerClientId);
        for (const clientId of clientIdSet) {
            const com = this.clients.get(clientId).get("com");
            const messageObj = com.send(msg);
            pendings.push(messageObj.wait());
        }
        await Promise.allSettled(pendings);

    };
    async addJoin(lang, peerUserId, hostUserId, isRemember, peerClientId, hostClientId) {
        // create unique joinId
        let joinId = undefined;
        while (joinId === undefined) {
            joinId = generateId(10);
            // check memory
            if (this.joins.has(joinId) === true) {
                joinId = undefined;
                continue;
            }
            // check database
            const existing = await this.db.select().table("joins").where("join_id", joinId).first();
            if (existing !== undefined) {
                joinId = undefined;
                continue;
            }
        }

        // create peerCode/hostCode
        let peerCode = generateId(10);
        let hostCode = generateId(10);
        while (hostCode === peerCode) {
            hostCode = generateId(10);
        }

        // create random name
        const name = generateId(3, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") + getText("room", lang);

        // add to database
        if (isRemember === true) {
            // insert into db
            const row = {
                "join_id": joinId,
                "peer_code": peerCode,
                "host_code": hostCode,
                "host_name": name,
                "peer_name": name
            };
            if (hostUserId !== undefined) {
                row["host_user_id"] = hostUserId;
            }
            if (peerUserId !== undefined) {
                row["peer_user_id"] = peerUserId;
            }
            await this.db.insert(row).into("joins");
        }

        // add to memory
        this.addJoinMemory(joinId, peerCode, hostCode, peerUserId, hostUserId, name, name, isRemember);
        this.addClientJoin(joinId, peerClientId, hostClientId, false)

        // notify registered users (peers)
        const msg = {
            "timestamp": Date.now(),
            "type": "devices",
            "value": {
                "joinId": joinId,
                "isRemember": isRemember,
                "name": name,
                "isOnline": true
            }
        };
        this.broadcastJoin(joinId, msg, true, false, false, false, peerClientId);

        // notify registered users (hosts)
        const msg2 = {
            "timestamp": Date.now(),
            "type": "shares",
            "value": {
                "joinId": joinId,
                "isRemember": isRemember,
                "name": name,
                "isOnline": true
            }
        };
        this.broadcastJoin(joinId, msg2, false, true, false, false, hostClientId);

        return {"joinId": joinId, "peerCode": peerCode, "hostCode": hostCode};
    };
    async updateJoin(joinId, key, value, peerClientId, hostClientId) {
        let isInMemory = false;
        let isInDatabase = false;
        // get join data in memory
        let join = this.joins.get(joinId);
        if (join !== undefined) {
            isInMemory = true;
        }
        // index db exist (or load data if memory data not exist)
        if (isInMemory === false || join.get("isRemember") === true) {
            isInDatabase = true;
            // create fake join object
            if (join === undefined) {
                const dbEntry = await this.db.select().table("joins").where("join_id", joinId).first();
                if (dbEntry === undefined) {
                    return;
                }
                join = new Map();
                join.set("peerCode", dbEntry["peer_code"]);
                join.set("hostCode", dbEntry["host_code"]);
                if (dbEntry["peer_user_id"] !== null) {
                    join.set("peerUserId", dbEntry["peer_user_id"]);
                }
                if (dbEntry["host_user_id"] !== null) {
                    join.set("hostUserId", dbEntry["host_user_id"]);
                }
                join.set("peerName", dbEntry["peer_name"]);
                join.set("hostName", dbEntry["host_name"]);
                join.set("isRemember", true);
                join.set("peerClientIds", new Set());
                join.set("hostClientIds", new Set());
            }
        }

        // edit data
        if (key === "name") {
            // check value and skip if not changed
            if ((peerClientId !== undefined && join.get("peerName") === value) || (hostClientId !== undefined && join.get("hostName") === value)) {
                return;
            }

            let isCommonUserId = false;
            if (join.get("peerUserId") === join.get("hostUserId")) {
                isCommonUserId = true;
            }

            // set memory data
            if (isInMemory === true) {
                if (isCommonUserId === true) {
                    join.set("peerName", value);
                    join.set("hostName", value);
                } else if (peerClientId !== undefined) {
                    join.set("peerName", value);
                } else {
                    join.set("hostName", value);
                }
            }

            // update database
            if (isInDatabase === true) {
                if (isCommonUserId === true) {
                    await this.db.where("join_id", joinId).update({"peer_name": value, "host_name": value});
                } else if (peerClientId !== undefined) {
                    await this.db.where("join_id", joinId).update({"peer_name": value});
                } else {
                    await this.db.where("join_id", joinId).update({"host_name": value});   
                }
            }

            // broadcast change to connected clients
            if (peerClientId !== undefined || isCommonUserId === true) {
                const msg = {
                    "timestamp": Date.now(),
                    "type": "devices",
                    "isChange": true,
                    "value": {
                        "joinId": joinId,
                        "name": value
                    }
                };
                // notify to devices and peers
                this.broadcastJoin(joinId, msg, true, false, true, false, peerClientId);
            }
            if (hostClientId !== undefined || isCommonUserId === true) {
                const msg = {
                    "timestamp": Date.now(),
                    "type": "shares",
                    "isChange": true,
                    "value": {
                        "joinId": joinId,
                        "name": value
                    }
                };
                // notify to shares and hosts
                this.broadcastJoin(joinId, msg, false, true, false, true, hostClientId);
            }
            
        } else if (key === "isRemember") {
            // check value and skip if not changed
            if (join.get("isRemember") === value) {
                return;
            }

            // set memory data
            if (isInMemory === true) {
                join.set("isRemember", value);
            }

            // update database
            if (isInDatabase === true) {
                if (value === true) {
                    // add to database
                   const newObj = {
                        "join_id": joinId,
                        "peer_code": join.get("peerCode"),
                        "host_code": join.get("hostCode"),
                        "peer_name": join.get("peerName"),
                        "host_name": join.get("hostName")
                    };
                    if (join.get("peerUserId") !== undefined) {
                        newObj["peer_user_id"] = join.get("peerUserId");
                    }
                    if (join.get("hostUserId") !== undefined) {
                        newObj["host_user_id"] = join.get("hostUserId");
                    }
                    await this.db.insert(newObj).into("joins");
                } else {
                    // remove from database
                    await this.db.where("join_id", joinId).del();
                }
            }
            
            // in that case remove broadcast
            if (isInMemory === false && value === false) {
                // broadcast devices and peers
                const msg = {
                    "timestamp": Date.now(),
                    "type": "devices",
                    "isRemove": true,
                    "value": {
                        "joinId": joinId,
                        "isRemember": value
                    }
                };
                this.broadcastJoin(joinId, msg, true, false, false, false, peerClientId);

                // broadcast shares and hosts
                const msg2 = {
                    "timestamp": Date.now(),
                    "type": "shares",
                    "isRemove": true,
                    "value": {
                        "joinId": joinId,
                        "isRemember": value
                    }
                };
                this.broadcastJoin(joinId, msg2, false, true, false, false, hostClientId);

            } else {
                // broadcast devices and peers
                const msg = {
                    "timestamp": Date.now(),
                    "type": "devices",
                    "isChange": true,
                    "value": {
                        "joinId": joinId,
                        "isRemember": value
                    }
                };
                this.broadcastJoin(joinId, msg, true, false, true, false, peerClientId);

                // broadcast shares and hosts
                const msg2 = {
                    "timestamp": Date.now(),
                    "type": "shares",
                    "isChange": true,
                    "value": {
                        "joinId": joinId,
                        "isRemember": value
                    }
                };
                this.broadcastJoin(joinId, msg2, false, true, false, true, hostClientId);
            }
            
        } else if (key === "rehost") {
            // check if new host is same with current host
            if (join.get("hostClientIds").has(peerClientId) === true) {
                return;
            }

            // create unique hostCode
            let hostCode = undefined;
            while (hostCode === join.get("peerCode")) {
                hostCode = generateId(10);
            }

            // broadcast change to old host clients
            const msg = {
                "timestamp": Date.now(),
                "type": "shares",
                "isChange": true,
                "value": {
                    "joinId": joinId,
                    "hostCode": true    // host code is secret but we can notify host change by this flag
                }
            };
            this.broadcastJoin(joinId, msg, false, false, false, true, hostClientId);

            // set memory
            if (isInMemory === true) {
                const hostClientIds = join.get("hostClientIds");
                for (const hostClientId of hostClientIds) {
                    this.removeClientJoin(joinId, undefined, hostClientId, false);
                }
                hostClientIds.add(hostClientId);
                join.set("hostCode", hostCode);
            }

            // set db
            if (isInDatabase === true) {
                await this.db.where("join_id", joinId).update({"host_code": hostCode});
            }

            // broadcast change to peer devices
            const msg2 = {
                "timestamp": Date.now(),
                "type": "devices",
                "isChange": true,
                "value": {
                    "joinId": joinId,
                    "hostCode": true
                }
            };
            this.broadcastJoin(joinId, msg2, true, false, true, false, hostClientId);

            return hostCode;
        }
    };
    addJoinMemory(joinId, peerCode, hostCode, peerUserId, hostUserId, peerName, hostName, isRemember) {
        // add join to memory (if not exists)
        let join = this.joins.get(joinId);
        if (join !== undefined) {
            return;
        }
        join = new Map([
            ["peerCode", peerCode],
            ["hostCode", hostCode],
            ["peerName", peerName],
            ["hostName", hostName],
            ["isRemember", isRemember],
            ["peerClientIds", new Set()],
            ["hostClientIds", new Set()]
        ]);
        if (peerUserId !== undefined) {
            join.set("peerUserId", peerUserId);
            // indexing
            const joinsUser = this.joinsUser.get(peerUserId);
            if (joinsUser === undefined) {
                this.joinsUser.set(peerUserId, new Set([joinId]));
            } else {
                joinsUser.add(joinId);
            }
        }
        if (hostUserId !== undefined) {
            join.set("hostUserId", hostUserId);
            // indexing
            const joinsUser = this.joinsUser.get(hostUserId);
            if (joinsUser === undefined) {
                this.joinsUser.set(hostUserId, new Set([joinId]));
            } else {
                joinsUser.add(joinId);
            }
        }
        this.joins.set(joinId, join);
    };
    async removeJoin(joinId, callerClientId) {
        const join = this.joins.get(joinId);

        // collect clientIds to notify
        const msg = {
            "timestamp": Date.now(),
            "type": "devices",
            "isRemove": true,
            "value": {
                "joinId": joinId
            }
        };
        this.broadcastJoin(joinId, msg, true, false, true, false, callerClientId);

        const msg2 = {
            "timestamp": Date.now(),
            "type": "shares",
            "isRemove": true,
            "value": {
                "joinId": joinId
            }
        };
        this.broadcastJoin(joinId, msg2, false, true, false, true, callerClientId);

        // remove from database
        await this.db("joins").where("join_id", joinId).delete();

        // remove from memory
        const peerClientIds = join.get("peerClientIds");
        for (const peerClientId of peerClientIds) {
            this.removeClientJoin(joinId, peerClientId, undefined, false);
        }
        const hostClientIds = join.get("hostClientIds");
        for (const hostClientId of hostClientIds) {
            this.removeClientJoin(joinId, undefined, hostClientId, false);
        }
    };
    addClientJoin(joinId, peerClientId, hostClientId, notifyOthers=false) {
        const join = this.joins.get(joinId);

        // add peer
        if (peerClientId !== undefined) {
            join.get("peerClientIds").add(peerClientId);
            const peerJoinSet = this.clients.get(peerClientId).get("joinIds");
            if (peerJoinSet === undefined) {
                this.clients.get(peerClientId).set("joinIds", new Set());
            }
            peerJoinSet.add(joinId);
        }

        // add host
        if (hostClientId !== undefined) {
            join.get("hostClientIds").add(hostClientId);
            const hostJoinSet = this.clients.get(hostClientId).get("joinIds");
            if (hostJoinSet === undefined) {
                this.clients.get(hostClientId).set("joinIds", new Set());
            }
            hostJoinSet.add(joinId);

            // broadcast (only host add)
            if (notifyOthers === true && join.get("hostClientIds").size === 1) {
                // notify registered users (peers) and connected clients (peers)
                const msg = {
                    "timestamp": Date.now(),
                    "type": "devices",
                    "isChange": true,
                    "value": {
                        "joinId": joinId,
                        "isOnline": true
                    }
                };
                this.broadcastJoin(joinId, msg, true, false, true, false, peerClientId);
                
                // notify registered non-local users (hosts)
                const msg2 = {
                    "timestamp": Date.now(),
                    "type": "shares",
                    "isChange": true,
                    "value": {
                        "joinId": joinId,
                        "isOnline": true
                    }
                };
                this.broadcastJoin(joinId, msg2, false, true, false, false, hostClientId);
            }
        }

    };
    removeClientJoin(joinId, peerClientId, hostClientId, notifyOthers=false) {
        const join = this.joins.get(joinId);

        // remove peer
        if (peerClientId !== undefined) {
            this.clients.get(peerClientId).get("joinIds").delete(joinId);
            join.get("peerClientIds").delete(peerClientId);
        }

        // remove host
        if (hostClientId !== undefined) {
            // remove host
            this.clients.get(hostClientId).get("joinIds").delete(joinId);
            join.get("hostClientIds").delete(hostClientId);
            // notifiy if 
            if (notifyOthers && join.get("hostClientIds").size === 0) {
                // notify registered users (peers) and connected clients (peers)
                const msg = {
                    "timestamp": Date.now(),
                    "type": "devices",
                    "isChange": true,
                    "value": {
                        "joinId": joinId,
                        "isOnline": false
                    }
                };
                this.broadcastJoin(joinId, msg, true, false, true, false, peerClientId);
                
                // notify registered non-local users (hosts)
                const msg2 = {
                    "timestamp": Date.now(),
                    "type": "shares",
                    "isChange": true,
                    "value": {
                        "joinId": joinId,
                        "isOnline": false
                    }
                };
                this.broadcastJoin(joinId, msg2, false, true, false, false, hostClientId);
            }
        }

        // cleanup form memory if no client and no peer user subscription
        let isPeerSubscribed = false;
        const peerUserId = join.get("peerUserId");
        if (peerUserId !== undefined) {
            const peerSubscription = this.subscriptions.get("devices").get(peerUserId);
            console.log(peerSubscription)
            if (peerSubscription !== undefined && peerSubscription.size > 0) {
                isPeerSubscribed = true;
            }
        }
        console.log(isPeerSubscribed);
        const clientCount = join.get("hostClientIds").size + join.get("peerClientIds").size;
        if (clientCount === 0 && !isPeerSubscribed) {
            this.joins.delete(joinId);
            const peerUserJoins = this.joinsUser.get(peerUserId);
            if (peerUserJoins !== undefined) {
                peerUserJoins.delete(joinId);
                if (peerUserJoins.size === 0) {
                    this.joinsUser.delete(peerUserId);
                }
            }
            const hostUserJoins = this.joinsUser.get(join.get("hostUserId"));
            if (hostUserJoins !== undefined) {
                hostUserJoins.delete(joinId);
                if (hostUserJoins.size === 0) {
                    this.joinsUser.delete(join.get("hostUserId"));
                }
            }
        }
        console.log(join);
    };
    
    async updateUserData(userId, type, data) {
        let subscribedClients;
        let value;
        if (type === "picture") {
            const user = await this.db.select().table("users_google").where("user_id", userId).first();
            if (typeof user === "undefined" || user["picture"] === data) {
                return;
            }
            await this.db("users_google").where("user_id", userId).update({"picture": data});
            subscribedClients = this.subscriptions.get("picture").get(userId);
            const imageData = await this.httpsGetImage(data);
            value = imageData;

        }  else if (type === "email") {
            const user = await this.db.select().table("users").where("user_id", userId).first();
            if (typeof user === "undefined" || user["email"] === data) {
                return;
            }
            await this.db("users").where("user_id", userId).update({"email": data});
            subscribedClients = this.subscriptions.get("email").get(userId);
            value = data;

        } else if (type === "firstName") {
            const user = await this.db.select().table("users").where("user_id", userId).first();
            if (typeof user === "undefined" || user["first_name"] === data) {
                return;
            }
            await this.db("users").where("user_id", userId).update({"first_name": data});
            subscribedClients = this.subscriptions.get("firstName").get(userId);
            value = data;

        } else if (type === "lastName") {
            const user = await this.db.select().table("users").where("user_id", userId).first();
            if (typeof user === "undefined" || user["last_name"] === data) {
                return;
            }
            await this.db("users").where("user_id", userId).update({"last_name": data});
            subscribedClients = this.subscriptions.get("lastName").get(userId);
            value = data;
        }

        // broadcast to subscribed clients
        if (subscribedClients !== undefined) {
            for (const clientId of subscribedClients) {
                const com = this.clients.get(clientId).get("com");
                const messageObj = com.send({
                    "timestamp": Date.now(),
                    "type": type,
                    "value": value
                });
                await messageObj.wait();
            }
        }

    };
    async handleAPI(messageObj, clientId) {
        //check basic structure
        await messageObj.wait();
        const message = messageObj.data;
        if (typeof message !== "object" && typeof message["type"] !== "string") {
            console.log("Invalid message format", message);
            messageObj.abort();
            return;
        }
        const client = this.clients.get(clientId);

        // refresh session
        if (client.get("isLoggedIn") === true) {
            const ip = client.get("ws")._socket.remoteAddress;
            const result = await this.updateSession(client.get("userId"), client.get("sessionId"), Date.now() + 7 * 24 * 60 * 60 * 1000, Date.now(), ip, undefined);
            if (result === undefined) {
                // session expired
                await this.removeSession(client.get("userId"), client.get("sessionId"));
            }
        }
        
        // config getter
        if (message["type"] === "conf-get") {
            messageObj.send(this.clientConf);
            return;
        }
        
        // account management
        if (message["type"] === "login-google") {
            /*{
                "credential": string
            }*/
           /*{
                "success": boolean,
                "sessionId": string,
                "sessionKey": string
            }*/
            // check inputs
            const credential = message["credential"];
            const userAgent = message["userAgent"];
            if (typeof credential !== "string" || typeof userAgent !== "string") {
                messageObj.send({"success": false});
                return;
            }
            
            // check credential
            const userInfo = await this.authGoogle(credential);
            if (typeof userInfo === "undefined") {
                messageObj.send({"success": false});
                return;
            }

            // check already logged in
            if (client.get("isLoggedIn") === true) {
                const exitsUser = await this.db.select().table("users_google").where({"sub": userInfo["sub"], "user_id": client.get("userId")}).first();
                if (typeof exitsUser !== "undefined") {
                    const session = await this.db.select().table("sessions").where("session_id", client.get("sessionId")).andWhere("expire", ">", Date.now()).first();
                    messageObj.send({
                        "success": true,
                        "sessionId": session["session_id"],
                        "sessionKey": session["session_key"]
                    });
                    return;
                }
                // logout previous session
                await this.removeSession(client.get("userId"), client.get("sessionId"));
            }

            // search for existing user
            let exitsUser = await this.db.select().table("users_google").where("sub", userInfo["sub"]).first();

            // create user if not exists
            if (typeof exitsUser === "undefined") {
                // generate new user id
                let userId = undefined;
                while (typeof userId === "undefined") {
                    userId = generateId(10);
                    const existing = await this.db.select().table("users").where("user_id", userId).first();
                    if (existing !== undefined) {
                        userId = undefined;
                    }
                }

                // insert into users table
                await this.db.insert({
                    "user_id": userId,
                    "email": userInfo["email"],
                    "first_name": userInfo["given_name"],
                    "last_name": userInfo["family_name"]
                }).into("users");

                // insert into users_google table
                await this.db.insert({
                    "sub": userInfo["sub"],
                    "user_id": userId,
                    "picture": userInfo["picture"]
                }).into("users_google");

                exitsUser = {
                    "user_id": userId
                };
            }

            // update account data if changed
            this.updateUserData(exitsUser["user_id"], "email", userInfo["email"]);
            this.updateUserData(exitsUser["user_id"], "firstName", userInfo["given_name"]);
            this.updateUserData(exitsUser["user_id"], "lastName", userInfo["family_name"]);
            this.updateUserData(exitsUser["user_id"], "picture", userInfo["picture"]);

            // create session
            const ip = client.get("ws")._socket.remoteAddress;
            const { sessionId, sessionKey } = await this.addSession(exitsUser["user_id"], ip, userAgent);
            this.addClientSession(exitsUser["user_id"], sessionId, clientId);

            messageObj.send({
                "success": true,
                "sessionId": sessionId,
                "sessionKey": sessionKey
            });
            return;
        }

        if (message["type"] === "login-session") {
            /*{
                "sessionKey": string
            }*/
            /*{
                "success": boolean
            }*/
            // check inputs
            const sessionKey = message["sessionKey"];
            if (typeof sessionKey !== "string") {
                messageObj.send({"success": false});
                return;
            }

            // check session in db
            const session = await this.db.select().table("sessions").where("session_key", sessionKey).andWhere("expire", ">", Date.now()).first();
            if (session === undefined) {
                messageObj.send({"success": false});
                return;
            }
            await this.db.update({"expire": Date.now() + 7 * 24 * 60 * 60 * 1000}).table("sessions").where("session_key", sessionKey);

            // check already logged in
            if (client.get("isLoggedIn") === true) {
                if (session["user_id"] === client.get("userId")) {
                    messageObj.send({
                        "success": true
                    });
                    return;
                }
                // logout previous session
                this.removeClientSession(client.get("userId"), client.get("sessionId"), clientId);
            }

            // add session to client
            this.addClientSession(session["user_id"], session["session_id"], clientId);

            // update ip address and expire time
            const ip = client.get("ws")._socket.remoteAddress;
            await this.updateSession(session["user_id"], session["session_id"], Date.now() + 7 * 24 * 60 * 60 * 1000, Date.now(), ip, undefined);

            messageObj.send({
                "success": true
            });
            return;
        }

        if (message["type"] === "logout") {
            /*{
                "sessionId": string
            }*/
            /*{
                "success": boolean
            }*/
            // check logged in
            if (client.get("isLoggedIn") !== true) {
                messageObj.send({"success": false});
                return;
            }

            // check inputs
            let sessionId = message["sessionId"];
            if (typeof sessionId !== "string") {
                sessionId = client.get("sessionId");
            }

            // check permission
            const session = await this.db.select().table("sessions")
                .where({
                    "session_id": sessionId,
                    "user_id": client.get("userId")
                })
                .andWhere("expire", ">", Date.now()).first();
            if (session === undefined) {
                messageObj.send({"success": false});
                return;
            }

            if (sessionId === client.get("sessionId")) {
                this.removeClientSession(session["user_id"], sessionId, clientId);  // prevent event send 
            }
            await this.removeSession(session["user_id"], sessionId);
            messageObj.send({"success": true});
            return;
        }

        if (message["type"] === "user-data-subscribe") {
            /*{
                "key": string,
                "once": boolean
                ...params
            }*/
            /*{
                "success": boolean,
                "value": any
            }*/
            // check inputs
            const key = message["key"];
            if (typeof key !== "string" || !["email", "firstName", "lastName", "picture", "sessions", "devices", "shares"].includes(key)) {
                messageObj.send({"success": false});
                return;
            }
            const once = message["once"];

            // check permission
            if (client.get("isLoggedIn") !== true) {
                messageObj.send({"success": false});
                return;
            }

            let value;
            const user = await this.db.select().table("users").where("user_id", client.get("userId")).first();
            if (key === "email") {
                value = user["email"];
            } else if (key === "firstName") {
                value = user["first_name"];
            } else if (key === "lastName") {
                value = user["last_name"];
            } else if (key === "picture") {
                const userGoogle = await this.db.select().table("users_google").where("user_id", client.get("userId")).first();
                const imageData = await this.httpsGetImage(userGoogle["picture"]);
                value = imageData;
            } else if (key === "sessions") {
                const sessions = await this.db.select().table("sessions").where("user_id", client.get("userId")).andWhere("expire", ">", Date.now());
                value = [];
                for (const session of sessions) {
                    value.push({
                        "sessionId": session["session_id"],
                        "expire": session["expire"],
                        "lastUsed": session["last_used"],
                        "ipAddress": session["ip_address"],
                        "userAgent": session["user_agent"]
                    });
                }
            } else if (key === "devices") {
                const joinsSet = new Set();
                // get all sessions
                const joinsUser = this.joinsUser.get(client.get("userId"));
                if (joinsUser !== undefined) {
                    for (const joinId of joinsUser) {
                        const join = this.joins.get(joinId);
                        if (join.get("peerUserId") === client.get("userId")) {
                            joinsSet.add(joinId);
                        }
                    }
                }
                
                // query permanent joins from db
                const joinsRememberMap = new Map();
                const joinsRemember = await this.db.select().table("joins").where("peer_user_id", client.get("userId"));
                if (joinsRemember !== undefined) {
                    for (const join of joinsRemember) {
                        joinsSet.add(join["join_id"]);
                        joinsRememberMap.set(join["join_id"], new Map([
                            ["peerCode", join["peer_code"]],
                            ["peerName", join["peer_name"]]
                        ]));
                    }
                }

                // return getted joins
                value = [];
                for (const joinId of joinsSet) {
                    const join = this.joins.get(joinId);
                    // peerCode, name
                    let peerCode = "";
                    let name = "";
                    if (joinsRememberMap.has(joinId)) {
                        peerCode = joinsRememberMap.get(joinId).get("peerCode");
                        name = joinsRememberMap.get(joinId).get("peerName");
                    } else if (join !== undefined) {
                        peerCode = join.get("peerCode");
                        name = join.get("peerName");
                    }
                    // is remember
                    let isRemember = false;
                    if (joinsRememberMap.has(joinId)) {
                        isRemember = true;
                    }
                    // check if is online
                    let isOnline = false;
                    if (join !== undefined && join.get("hostClientIds").size > 0) {
                        isOnline = true;
                    }
                    value.push({
                        "joinId": joinId,
                        "name": name,
                        "isRemember": isRemember,
                        "isOnline": isOnline
                    });
                }

            } else if (key === "shares") {
                const joinsSet = new Set();
                // get all sessions
                const joinsUser = this.joinsUser.get(client.get("userId"));
                if (joinsUser !== undefined) {
                    for (const joinId of joinsUser) {
                        const join = this.joins.get(joinId);
                        if (join.get("hostUserId") === client.get("userId")) {
                            joinsSet.add(joinId);
                        }
                    }
                }

                // query permanent joins from db
                const joinsRememberMap = new Map();
                const joinsRemember = await this.db.select().table("joins").where("host_user_id", client.get("userId"));
                if (joinsRemember !== undefined) {
                    for (const join of joinsRemember) {
                        joinsSet.add(join["join_id"]);
                        joinsRememberMap.set(join["join_id"], join["host_name"]);
                    }
                }

                // return getted joins
                value = [];
                for (const joinId of joinsSet) {
                    const join = this.joins.get(joinId);
                    // name
                    let name = "";
                    if (joinsRememberMap.has(joinId)) {
                        name = joinsRememberMap.get(joinId);
                    } else if (join !== undefined) {
                        name = join.get("hostName");
                    }
                    // is remember
                    let isRemember = false;
                    if (joinsRememberMap.has(joinId)) {
                        isRemember = true;
                    }
                     // check if is online
                    let isOnline = false;
                    if (join !== undefined && join.get("hostClientIds").size > 0) {
                        isOnline = true;
                    }
                    value.push({
                        "joinId": joinId,
                        "name": name,
                        "isOnline": isOnline,
                        "isRemember": isRemember
                    });
                }
            }

            // subscribe to updates
            if (once !== true) {
                this.addClientSubscription(key, client.get("userId"), clientId);
            }

            // send current data
            messageObj.send({"success": true, "value": value});
            return;
        }

        if (message["type"] === "user-data-unsubscribe") {
            /*{
                "key": string
            }*/
            /*{
                "success": boolean
            }*/
            // check inputs
            const key = message["key"];
            if (typeof key !== "string" || !["email", "firstName", "lastName", "picture", "sessions", "devices", "shares"].includes(key)) {
                messageObj.send({"success": false});
                return;
            }

            // check permission
            if (client.get("isLoggedIn") !== true) {
                messageObj.send({"success": false});
                return;
            }

            this.removeClientSubscription(key, client.get("userId"), clientId);
            messageObj.send({"success": true});
            return;
        }

        if (message["type"] === "delete-email") {
            /*{
                "lang": string
            }*/
            /*{
                "success": boolean
            }*/
            // check permission
            if (client.get("isLoggedIn") !== true) {
                messageObj.send({"success": false});
                return;
            }

            // check inputs
            let lang = message["lang"];
            if (typeof lang !== "string" || !["en", "hu"].includes(lang)) {
                lang = "en";
            }

            // generate delete id
            let deleteId = undefined;
            while (deleteId === undefined) {
                deleteId = generateId(10);
                const existing = await this.db.select().table("delete").where("delete_id", deleteId).first();
                if (existing !== undefined) {
                    deleteId = undefined;
                }
            }

            // generate delete key
            let deleteKey = undefined;
            while (deleteKey === undefined) {
                deleteKey = generateId(10);
                const existing = await this.db.select().table("delete").where("delete_key", deleteKey).first();
                if (existing !== undefined) {
                    deleteKey = undefined;
                }
            }

            // insert into delete table
            await this.db.insert({
                "delete_id": deleteId,
                "user_id": client.get("userId"),
                "delete_key": deleteKey,
                "expire": Date.now() + 1 * 60 * 60 * 1000
            }).into("delete");

            // send delete email
            const user = await this.db.select().table("users").where("user_id", client.get("userId")).first();
            try {
                await this.mailers[0].sendMail({
                    "from": this.mailers[0].options.auth.user,
                    "to": user["email"],
                    "subject": "Account Deletion Request",
                    "text": 
                        getText("delete.0", lang) + this.domain + 
                        getText("delete.1", lang) + "\n\n" + deleteKey + "\n\n" +
                        getText("delete.2", lang)
                });
            } catch (error) {
                messageObj.send({"success": false});
                console.log("Error sending delete email:", error);
                return;
            }
            messageObj.send({"success": true});
            return;
        }

        if (message["type"] === "delete") {
            /*{
                "deleteKey": string
            }*/
            /*{
                "success": boolean
            }*/

            // check inputs
            const deleteKey = message["deleteKey"];
            if (typeof deleteKey !== "string") {
                messageObj.send({"success": false});
                return;
            }

            // check permission
            if (client.get("isLoggedIn") !== true) {
                messageObj.send({"success": false});
                return;
            }
            const userId = client.get("userId");
            const sessionId = client.get("sessionId");
            const deleteEntry = await this.db.select().table("delete").where({"user_id": userId, "delete_key": deleteKey}).andWhere("expire", ">", Date.now()).first();
            if (deleteEntry === undefined) {
                messageObj.send({"success": false});
                return;
            }

            messageObj.send({"success": true});

            // delete client in sessions and logout other clients
            this.removeClientSession(userId, sessionId, clientId);
            const sessions = await this.db.select().table("sessions").where("user_id", userId);
            if (sessions !== undefined) {
                for (const session of sessions) {
                    await this.removeSession(session["user_id"], session["session_id"]);
                }
            }

            // delete user from db
            await this.db("users").where("user_id", userId).delete();
            return;
        }

        /*
        events:
        {
            "timestamp": number,
            "type": string // "logout" | "email" | "firstName" | "lastName" | "picture" | "sessions" | "devices" | "shares"
            "isChange": boolean,
            "isRemove": boolean,
            "value": any
        }*/

        // pairing management
        if (message["type"] === "pair-create") {
            /*{
                "success": boolean,
                "pairCode": string
            }*/

            // check if already has pair code
            if (client.get("pairCode") !== undefined) {
                this.removePairCode(clientId, false, true);
            }

            // create pair code
            const pairCode = this.addPairCode(clientId);
            messageObj.send({"success": true, "pairCode": pairCode});

            return;
        }
        if (message["type"] === "pair-request") {
            /*{
                "pairCode": string
            }*/
            /*{
                "success": boolean,
                "isBusy": boolean,
                "timeout": number,
                "details": {"ipAddress": string, "isUser": boolean, "firstName"?: string, "lastName"?: string}
            }*/

            // check inputs
            const pairCode = message["pairCode"];
            if (typeof pairCode !== "string") {
                messageObj.send({"success": false});
                return;
            }

            // delete already pair
            if (client.get("pairCode") !== undefined) {
                this.removePairCode(clientId, false, true);
            }

            // check pair
            const pair = this.pairs.get(pairCode);
            if (pair === undefined) {
                messageObj.send({"success": false});
                return;
            }

            // lock pair
            const pairPeerClientId = pair.get("peerClientId");
            if (pairPeerClientId !== undefined) {
                messageObj.send({"success": false, "isBusy": true});
                return;
            }
            pair.set("peerClientId", clientId);
            this.clients.get(clientId).set("pairCode", pairCode);

            // send request event to host client
            const details = {
                "ipAddress": client.get("ws")._socket.remoteAddress,
                "isUser": client.get("isLoggedIn") === true
            };
            if (client.get("isLoggedIn") === true) {
                details["firstName"] = (await this.db.select().table("users").where("user_id", client.get("userId")).first())["first_name"];
                details["lastName"] = (await this.db.select().table("users").where("user_id", client.get("userId")).first())["last_name"];
            }

            const timeout = 10000;
            // send pair request to host
            const hostClientId = pair.get("hostClientId");
            const hostClient = this.clients.get(hostClientId);
            const hostMessageObj = hostClient.get("com").send({
                "timestamp": Date.now(),
                "type": "pair-request",
                "details": details,
                "timeout": timeout
            });
            await hostMessageObj.wait();

            if (hostMessageObj.error !== "") {
                messageObj.send({"success": false});
                pair.delete("peerClientId");
                return;
            }

            // start host timeout
            const timeoutId = setTimeout(() => {
                const peerClientId = pair.get("peerClientId");
                // remove timeouId
                pair.set("timeoutId", -1);
                // remove peer
                this.removePairCode(peerClientId, true, true);
            }, 10000);
            pair.set("timeoutId", timeoutId);
            messageObj.send({"success": true, "timeout": timeout, "details": details});
            return;
        }
        if (message["type"] === "pair-accept") {
            /*{
                "isRemember": boolean,
                "lang": string          // for default room name
            }*/
            /*{
                "success": boolean
                "joinCode": string
            }*/

            let isRemember = message["isRemember"];
            if (typeof isRemember !== "boolean") {
                isRemember = false;
            }
            let lang = message["lang"];
            if (typeof lang !== "string" || !["en", "hu"].includes(lang)) {
                lang = "en";
            }

            // check permission
            const pairCode = client.get("pairCode");
            if (pairCode === undefined) {
                messageObj.send({"success": false});
                return;
            }

            // get pair
            const pair = this.pairs.get(pairCode);

            // check host client
            if (pair.get("hostClientId") !== clientId) {
                messageObj.send({"success": false});
                return;
            }

            // check peer client
            const peerClientId = pair.get("peerClientId");
            if (peerClientId === undefined) {
                messageObj.send({"success": false});
                return;
            }

            // check remember permission
            const peerClient = this.clients.get(peerClientId);
            const hostClient = this.clients.get(clientId);
            if (isRemember === true && peerClient.get("isLoggedIn") === false && hostClient.get("isLoggedIn") === false) {
                isRemember = false;  // cannot remember if both sides are not logged in
            }

            // create join and register in memory
            const {joinId, peerCode, hostCode} = await this.addJoin(lang, peerClient.get("userId"), hostClient.get("userId"), isRemember, peerClientId, clientId);
            // const joinId = "0000"; const peerCode = "1111"; const hostCode = "2222";

            // send to host
            messageObj.send({
                "success": true,
                "joinId": joinId,
                "hostCode": hostCode,
                "isRemember": isRemember,
                "hostName": this.joins.get(joinId).get("hostName")
            });

            // send accept to peer
            peerClient.get("com").send({
                "timestamp": Date.now(),
                "type": "pair-accept",
                "joinId": joinId,
                "peerCode": peerCode,
                "isRemember": isRemember,
                "peerName": this.joins.get(joinId).get("peerName")
            });
            
            // cleanup
            peerClient.delete("pairCode");
            client.delete("pairCode");
            clearTimeout(pair.get("timeoutId"));
            this.pairs.delete(pairCode);
            return;
        }
        if (message["type"] === "pair-reject") {
            /*{
                "success": boolean
            }*/
            // check permission
            const pairCode = client.get("pairCode");
            if (pairCode === undefined) {
                messageObj.send({"success": false});
                return;
            }

            // get pair
            const pair = this.pairs.get(pairCode);

            // check host client
            if (pair.get("hostClientId") !== clientId) {
                messageObj.send({"success": false});
                return;
            }

            // check peer client
            const peerClientId = pair.get("peerClientId");
            if (peerClientId === undefined) {
                messageObj.send({"success": false});
                return;
            }

            // delete peer
            this.removePairCode(peerClientId, true, false);
            messageObj.send({"success": true});
            return;
            
        }
        if (message["type"] === "pair-delete") {
            /*{
                "success": boolean
            }*/
            this.removePairCode(clientId, false, true);
            messageObj.send({"success": true});
            return;
        }
        /*
        events:
        {
            "timestamp": number,
            "type": string // "pair-request"
            "details": {"ipAddress": string, "isUser": boolean, "firstName"?: string, "lastName"?: string},
            "timeout": number
        }
        {
            "timestamp": number,
            "type": string // "pair-reject"
        }
        {
            "timestamp": number,
            "type": string // "pair-accept"
            "joinCode": string
        }*/

        // join management
        if (message["type"] === "join-connect") {
            /*{
                "joinId": string,
                "peerCode" | "hostCode": string
            }*/
            /*{
                "success": boolean,
                "values": {
                    "name": string,
                    "isOnline": boolean,
                    "isRemember": boolean
                }
            }*/
            //get input and check
            const joinId = message["joinId"];
            const peerCode = message["peerCode"];
            const hostCode = message["hostCode"];
            if (typeof joinId !== "string") {
                messageObj.send({"success": false});
                return;
            }
            if (peerCode === undefined && hostCode === undefined) {
                messageObj.send({"success": false});
                return;
            }
            
            // check memory
            let isInMemory = true;
            let join = this.joins.get(joinId);

            // check db (fallback)
            if (join === undefined) {
                isInMemory = false;
                const dbEntry = await this.db.select().table("joins").where("join_id", joinId)
                if (dbEntry === undefined) {
                    messageObj.send({"success": false});
                    return;
                }
                // create fake join object
                join = new Map();
                join.set("peerCode", dbEntry["peer_code"]);
                join.set("hostCode", dbEntry["host_code"]);
                if (dbEntry["peer_user_id"] !== null) {
                    join.set("peerUserId", dbEntry["peer_user_id"]);
                }
                if (dbEntry["host_user_id"] !== null) {
                    join.set("hostUserId", dbEntry["host_user_id"]);
                }
                join.set("peerName", dbEntry["peer_name"]);
                join.set("hostName", dbEntry["host_name"]);
                join.set("isRemember", true);
                join.set("peerClientIds", new Set());
                join.set("hostClientIds", new Set());
            }

            // check user permission
            let userId = client.get("userId");
            if ((peerCode !== undefined && userId !== join.get("peerUserId")) || (hostCode !== undefined && userId !== join.get("hostUserId"))) {
                messageObj.send({"success": false});
                return;
            }
            if ((peerCode !== undefined && join.get("peerCode") !== peerCode) || (hostCode !== undefined && join.get("hostCode") !== hostCode)) {
                messageObj.send({"success": false});
                return;
            }

            // register in memory
            if (isInMemory === false) {
                this.addJoinMemory(joinId, join.get("peerCode"), join.get("hostCode"), join.get("peerUserId"), join.get("hostUserId"), join.get("peerName"), join.get("hostName"), join.get("isRemember"));
            }
            if (peerCode !== undefined) {
                this.addClientJoin(joinId, clientId, undefined);
            } else {
                this.addClientJoin(joinId, undefined, clientId);
            }

            // reload join from memory
            join = this.joins.get(joinId);

            // return data
            let name = "";
            if (peerCode !== undefined) {
                name = join.get("peerName");
            } else {
                name = join.get("hostName");
            }
            const returnEntry = {
                "name": name,
                "isOnline": join.get("hostClientIds").size > 0 ? true : false,
                "isRemember": join.get("isRemember")
            };
            messageObj.send({"success": true, "value": returnEntry});
            return;
        }
        if (message["type"] === "join-disconnect") {
            /*{
                "joinId": string,
                "peerCode" | "hostCode": string
            }*/
            /*{
                "success": boolean
            }*/
            //get input and check
            let joinId = message["joinId"];
            if (typeof joinId !== "string") {
                messageObj.send({"success": false});
                return;
            }
            const peerCode = message["peerCode"];
            const hostCode = message["hostCode"];
            if (peerCode === undefined && hostCode === undefined) {
                messageObj.send({"success": false});
                return;
            }

            // check memory
            let join = this.joins.get(joinId);
            if (join === undefined) {
                messageObj.send({"success": false});
                return;
            }

            // check permission
            if (peerCode !== undefined) {
                if (join.get("peerCode") !== peerCode || join.get("peerClientIds").has(clientId) === false) {
                    messageObj.send({"success": false});
                    return;
                }
            } else if (hostCode !== undefined) {
                if (join.get("hostCode") !== hostCode || join.get("hostClientIds").has(clientId) === false) {
                    messageObj.send({"success": false});
                    return;
                }
            }

            // remove from memory
            if (peerCode !== undefined) {
                this.removeClientJoin(joinId, clientId, undefined);
            } else {
                this.removeClientJoin(joinId, undefined, clientId);
            }
            messageObj.send({"success": true});
            return;
        }
        if (message["type"] === "join") {
            /*{
                "joinId": string
            }*/
            /*
                 Client1                     Server                      Client2
                    |                           |                           |
                    |          {joinId}         |          {joinId}         |
                    |-------------------------->|-------------------------->|
                    |                           |                           |
                    |     {success,accepted}    |         {success}         |
                    |<--------------------------|<--------------------------|
                    |                           |                           |
                    |          {webrtc}         |          {webrtc}         |
                    |-------------------------->|-------------------------->|
                    |                           |                           |
                    |          ........         |          ........         |
                    |<--------------------------|<--------------------------|
                    |                           |                           |
                    |          {finish}         |          {finish}         |
                    |<--------------------------|<--------------------------|
                    |-------------------------->|                           |
            */
            
            // check inputs
            const joinId = message["joinId"];
            if (typeof joinId !== "string") {
                messageObj.send({"success": false});
                return;
            }

            // check memory
            const join = this.joins.get(joinId);
            if (join === undefined) {
                messageObj.send({"success": false});
                return;
            }

            // check permission
            if (join.get("peerClientIds").has(clientId) === false) {
                messageObj.send({"success": false});
                return;
            }

            // check availability
            const hostClientIds = join.get("hostClientIds");
            if (hostClientIds.size === 0) {
                messageObj.send({"success": false});
                return;
            }

            // send details to first host
            const hostClientId = hostClientIds.values().next().value;
            const hostClient = this.clients.get(hostClientId);
            const hostMessageObj = hostClient.get("com").invoke({
                "timestamp": Date.now(),
                "type": "join",
                "joinId": joinId
            });
            await hostMessageObj.wait();
            if (hostMessageObj.error !== "" || hostMessageObj.data["success"] !== true) {
                messageObj.send({"success": false, "accepted": false});
                return;
            }

            // send accept to peer
            messageObj.invoke({
                "success": true,
                "accepted": true
            });
            await messageObj.wait();
            if (messageObj.error !== "" || messageObj.data["success"] !== true) {
                // send error finish to host
                hostMessageObj.send({
                    "finish": false
                });
                return;
            }

            // start ping-pong between peer and host, and exchange webrtc offer/answer/candidates through server
            let isFinish = false;
            while (isFinish === false) {

                // send webrtc to host
                hostMessageObj.invoke({
                    "timestamp": Date.now(),
                    "webrtc": messageObj.data["webrtc"],
                    "finish": messageObj.data["finish"]
                });
                await hostMessageObj.wait();
                if (hostMessageObj.error !== "") {
                    // send error finish to peer
                    messageObj.send({
                        "finish": false
                    });
                    return;
                }

                // send webrtc to peer
                messageObj.invoke({
                    "timestamp": Date.now(),
                    "webrtc": hostMessageObj.data["webrtc"],
                    "finish": hostMessageObj.data["finish"]
                });
                await messageObj.wait();
                if (messageObj.error !== "") {
                    // send error finish to host
                    hostMessageObj.send({
                        "finish": false
                    });
                    return;
                }

                // close connection finish=true appears on peer side
                if (messageObj.data["finish"] === true) {
                    // send finish to host if it need answered
                    if (hostMessageObj.isInvoke === true) {
                        hostMessageObj.send({
                            "finish": true
                        });
                    }
                    isFinish = true;
                }
            }

            return;
        }
        if (message["type"] === "join-rename") {
            /*{
                "joinId": string,
                "name": string,
                "peerCode" | "hostCode": string
            }*/
            /*{
                "success": boolean
            }*/
            // get input and check
            let joinId = message["joinId"];
            let name = message["name"];
            if (typeof joinId !== "string" || typeof name !== "string") {
                messageObj.send({"success": false});
                return;
            }
            const peerCode = message["peerCode"];
            const hostCode = message["hostCode"];

            // check memory
            let join = this.joins.get(joinId);

            // check db (fallback)
            if (join === undefined) {
                const dbEntry = await this.db.select().table("joins").where("join_id", joinId)
                if (dbEntry === undefined) {
                    messageObj.send({"success": false});
                    return;
                }
                // create fake join object
                join = new Map();
                join.set("peerCode", dbEntry["peer_code"]);
                join.set("hostCode", dbEntry["host_code"]);
                if (dbEntry["peer_user_id"] !== null) {
                    join.set("peerUserId", dbEntry["peer_user_id"]);
                }
                if (dbEntry["host_user_id"] !== null) {
                    join.set("hostUserId", dbEntry["host_user_id"]);
                }
                join.set("peerName", dbEntry["peer_name"]);
                join.set("hostName", dbEntry["host_name"]);
                join.set("isRemember", true);
                join.set("peerClientIds", new Set());
                join.set("hostClientIds", new Set());
            }

            // check permission
            if (client.get("isLoggedIn") === false) {
                if (peerCode === undefined && hostCode === undefined) {
                    messageObj.send({"success": false});
                    return;
                }
                if (peerCode !== undefined && join.get("peerCode") !== peerCode) {
                    messageObj.send({"success": false});
                    return;
                } else if (hostCode !== undefined && join.get("hostCode") !== hostCode) {
                    messageObj.send({"success": false});
                    return;
                }
            } else {
                if (client.get("userId") !== join.get("peerUserId") && client.get("userId") !== join.get("hostUserId")) {
                    messageObj.send({"success": false});
                    return;
                }
            }

            // update name
            if (peerCode !== undefined || client.get("userId") === join.get("peerUserId")) {
                this.updateJoin(joinId, "name", name, clientId, undefined)
            } else if (hostCode !== undefined || client.get("userId") === join.get("hostUserId")) {
                this.updateJoin(joinId, "name", name, undefined, clientId);
            }

            messageObj.send({"success": true});
            return;
        }
        if (message["type"] === "join-remember") {
            /*{
                "joinId": string,
                "isRemember": boolean,
                "hostCode": string
            }*/
            /*{
                "success": boolean
            }*/
            let joinId = message["joinId"];
            let isRemember = message["isRemember"];
            if (typeof joinId !== "string" || typeof isRemember !== "boolean") {
                messageObj.send({"success": false});
                return;
            }
            const hostCode = message["hostCode"];

            // check memory
            const join = this.joins.get(joinId);
            if (join === undefined) {
                messageObj.send({"success": false});
                return;
            }

            // check db (fallback)
            if (join === undefined) {
                const dbEntry = await this.db.select().table("joins").where("join_id", joinId)
                if (dbEntry === undefined) {
                    messageObj.send({"success": false});
                    return;
                }
                // create fake join object
                join = new Map();
                join.set("peerCode", dbEntry["peer_code"]);
                join.set("hostCode", dbEntry["host_code"]);
                if (dbEntry["peer_user_id"] !== null) {
                    join.set("peerUserId", dbEntry["peer_user_id"]);
                }
                if (dbEntry["host_user_id"] !== null) {
                    join.set("hostUserId", dbEntry["host_user_id"]);
                }
                join.set("peerName", dbEntry["peer_name"]);
                join.set("hostName", dbEntry["host_name"]);
                join.set("isRemember", true);
                join.set("peerClientIds", new Set());
                join.set("hostClientIds", new Set());
            }

            // check permission
            if (client.get("isLoggedIn") === false) {
                if (hostCode === undefined) {
                    messageObj.send({"success": false});
                    return;
                }
                if (hostCode !== join.get("hostCode")) {
                    messageObj.send({"success": false});
                    return;
                }
            } else {
                if (client.get("userId") !== join.get("hostUserId")) {
                    messageObj.send({"success": false});
                    return;
                }
            }

            // update remember
            await this.updateJoin(joinId, "isRemember", isRemember, undefined, clientId);
            messageObj.send({"success": true});
            return;
        }
        if (message["type"] === "join-rehost") {
            /*{
                "joinId": string
            }*/
            /*{
                "success": boolean,
                "hostCode": string,
            }*/
            // get input and check
            let joinId = message["joinId"];
            if (typeof joinId !== "string") {
                messageObj.send({"success": false});
                return;
            }
            
            // check memory
            let join = this.joins.get(joinId);

            // check db (fallback)
            if (join === undefined) {
                const dbEntry = await this.db.select().table("joins").where("join_id", joinId)
                if (dbEntry === undefined) {
                    messageObj.send({"success": false});
                    return;
                }
                // create fake join object
                join = new Map();
                join.set("peerCode", dbEntry["peer_code"]);
                join.set("hostCode", dbEntry["host_code"]);
                if (dbEntry["peer_user_id"] !== null) {
                    join.set("peerUserId", dbEntry["peer_user_id"]);
                }
                if (dbEntry["host_user_id"] !== null) {
                    join.set("hostUserId", dbEntry["host_user_id"]);
                }
                join.set("peerName", dbEntry["peer_name"]);
                join.set("hostName", dbEntry["host_name"]);
                join.set("isRemember", true);
                join.set("peerClientIds", new Set());
                join.set("hostClientIds", new Set());
            }

            // check permission
            if (client.get("isLoggedIn") === false || client.get("userId") !== join.get("hostUserId")) {
                messageObj.send({"success": false});
                return;
            }

            // update host code
            const hostCode = this.updateJoin(joinId, "rehost", undefined, undefined, clientId);
            messageObj.send({"success": true, "hostCode": hostCode});
            return;
        }
        if (message["type"] === "join-delete") {
            /*{
                "joinId": string,
                "peerCode" | "hostCode": string
            }*/
            /*{
                "success": boolean,
            }*/
            // get input and check
            let joinId = message["joinId"];
            let name = message["name"];
            if (typeof joinId !== "string" || typeof name !== "string") {
                messageObj.send({"success": false});
                return;
            }
            const peerCode = message["peerCode"];
            const hostCode = message["hostCode"];

            // check memory
            let join = this.joins.get(joinId);

            // check db (fallback)
            if (join === undefined) {
                const dbEntry = await this.db.select().table("joins").where("join_id", joinId)
                if (dbEntry === undefined) {
                    messageObj.send({"success": false});
                    return;
                }
                // create fake join object
                join = new Map();
                join.set("peerCode", dbEntry["peer_code"]);
                join.set("hostCode", dbEntry["host_code"]);
                if (dbEntry["peer_user_id"] !== null) {
                    join.set("peerUserId", dbEntry["peer_user_id"]);
                }
                if (dbEntry["host_user_id"] !== null) {
                    join.set("hostUserId", dbEntry["host_user_id"]);
                }
                join.set("peerName", dbEntry["peer_name"]);
                join.set("hostName", dbEntry["host_name"]);
                join.set("isRemember", true);
                join.set("peerClientIds", new Set());
                join.set("hostClientIds", new Set());
            }

            // check permission
            if (client.get("isLoggedIn") === false) {
                if (peerCode === undefined && hostCode === undefined) {
                    messageObj.send({"success": false});
                    return;
                }
                if (peerCode !== undefined && join.get("peerCode") !== peerCode) {
                    messageObj.send({"success": false});
                    return;
                } else if (hostCode !== undefined && join.get("hostCode") !== hostCode) {
                    messageObj.send({"success": false});
                    return;
                }
            } else {
                if (client.get("userId") !== join.get("peerUserId") && client.get("userId") !== join.get("hostUserId")) {
                    messageObj.send({"success": false});
                    return;
                }
            }

            // delete join
            this.removeJoin(joinId, clientId);
            messageObj.send({"success": true});
            return;
        }
        /*
        events:
        {
            "timestamp": number,
            "type": string // "devices" | "shares"
            "isChange": boolean,
            "isRemove": boolean,
            "value": {
                "joinId": string,
                "name": string,
                "isRemember": boolean,
                "isOnline": boolean
            }
        },
        {
            "timestamp": number,
            "type": string // "join"
            "joinId": string
        }*/


        // unknown API
        console.log("Invalid request");
        messageObj.abort();
        return;
    };
    async clientConnect(ws) {
        // generate clientId for connection
        let clientId;
        do {
            clientId = Math.floor(Math.random() * 9999) + 1;
        } while (this.clients.has(clientId));  
        
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
        await com.sideSync();
        await com.timeSync();

        // create state
        /*{
            "com": Communicator,
            "ws": WebSocket,
            "isLoggedIn": false,
            "userId": undefined,
            "sessionId": undefined,
            "pairCode": undefined,
            "joinIds": undefined,
        }*/
        const client = new Map([
            ["com", com],
            ["ws", ws],
            ["isLoggedIn", false],
            ["joinIds", new Set()]
        ]);
        this.clients.set(clientId, client);

        // listen messages and handle API
        com.onIncoming(async (messageObj) => {
            try {
                await this.handleAPI(messageObj, clientId);
            } catch (error) {
                console.log("Error handling message:", error);
                client.get("ws").terminate();
            }
            
        });

        // listen error
        ws.addEventListener("error", (event) => {
            console.log("Error " + event.error);
        });

        // listen close
        ws.addEventListener("close", () => {
            // clean up
            const client = this.clients.get(clientId);
            client.get("com").release();
            if (client.get("isLoggedIn") === true) {
                this.removeClientSession(client.get("userId"), client.get("sessionId"), clientId);
            } else {
                // remove pair code
                this.removePairCode(clientId, false, true);

                // remove joins
                const joinIds = client.get("joinIds");
                for (const joinId of joinIds) {
                    const join = this.joins.get(joinId);
                    if (join.get("peerClientIds").has(clientId) === true && join.get("peerUserId") === client.get("userId")) {
                        this.removeClientJoin(joinId, clientId, undefined, true);
                        client.get("joinIds").delete(joinId);
                    } else if (join.get("hostClientIds").has(clientId) === true && join.get("hostUserId") === client.get("userId")) {
                        this.removeClientJoin(joinId, undefined, clientId, true);
                        client.get("joinIds").delete(joinId);
                    }
                }
            }
            this.clients.delete(clientId);
            
            console.log("Client disconnected (" + clientId + ")");
        });

        // debug info
        console.log("Client connected (" + clientId.toString().padStart(4, "0") + ")");

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
                    this.httpRedirect.close(function() {
                        clearTimeout(timeOut);
                        resolve(true);
                    });
                });
            }
            process.stdout.write("done\n");
        } else {
            process.stdout.write("skipped\n");
        }

        process.stdout.write("\n    Closing HTTP server....    ");
        if (this.httpServer !== null) {
            // close redirect server if exists
            if (this.httpRedirect !== null) {
                await new Promise((resolve) => {
                    const timeOut = setTimeout(function() {
                        resolve(false);
                    }, 5000);
                    this.httpRedirect.close(function() {
                        clearTimeout(timeOut);
                        resolve(true);
                    });
                });
            }
            
            // close HTTP server
            await new Promise((resolve) => {
                const timeOut = setTimeout(function() {
                    resolve(false);
                }, 5000);
                this.httpServer.close(function() {
                    clearTimeout(timeOut);
                    resolve(true);
                });
            });
            process.stdout.write("done\n");
        } else {
            process.stdout.write("skipped\n");
        }

        // clear cache
        this.httpCache.clear();

    };
};