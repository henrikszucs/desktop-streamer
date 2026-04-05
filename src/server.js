"use strict";

// internal dependencies
import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";

// third-party dependenciess
import JSZip from "jszip";
import { WebSocketServer } from "ws";
import Ajv from "ajv"

// first-party dependencies
import mime from "easy-mime";
import Communicator from "easy-communicator";

// avj load
const ajv = new Ajv();

// binary search in array [isFound, index]
const binarySearch = function(arr, x, getVal=function(el) {return el}) {   
    let start = 0;
    let end = arr.length - 1;
    let mid;
    while (start <= end) {
        mid = Math.floor((start + end) / 2);
        const val = getVal(arr[mid]);
        if (val === x) {
        	return [true, mid];
        }
  
        if (val < x) {
            start = mid + 1;
        } else {
            end = mid - 1;
        }
    }
    return [false, start];
};

// search in parameters
const getArg = function(args, argName, isKeyValue=false, isInline=false) {
    for (let i = 0, length=args.length; i < length; i++) {
        const arg = args[i];
        if (isKeyValue) {
            if (isInline) {
                if (arg.startsWith(argName + "=")) {
                    return arg.slice(argName.length + 1);
                }
            } else {
                if (arg === argName) {
                    return args[i + 1];
                }
            }
        } else {
            if (arg === argName) {
                return true;
            }
        }
    }
    return undefined;
};



// class that help to process configuration and compile clients
const Configure = class {
    constructor() {
        const schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": "Desktop Streamer Server Configuration",
            "type": "object",
            "required": ["domain", "port", "key", "cert", "webrtc"],
            "additionalProperties": false,
            "properties": {
                "domain": {
                    "type": "string",
                    "minLength": 1
                },
                "port": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 65535
                },
                "redirect": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 65535
                },
                "key": {
                    "type": "string",
                    "minLength": 1
                },
                "cert": {
                    "type": "string",
                    "minLength": 1
                },
                "ws": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 65535
                },
                "webrtc": {
                    "type": "object",
                    "required": ["iceServers"],
                    "additionalProperties": false,
                    "properties": {
                        "iceServers": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "minLength": 1
                            },
                            "minItems": 1
                        }
                    }
                }
            }
        };

        this.validate = ajv.compile(schema);
        this.serverScriptPath = import.meta.dirname;
        this.binsPath = path.join("./bin");
        this.binsSkipPaths = ["bin"];
        this.compilesPath = path.join("./tmp");
        this.compilesSkipPaths = ["tmp"];
        this.electronPath = path.join(this.serverScriptPath, "client/electron");
        this.electronNativePath = path.join(this.serverScriptPath, "client/electron-native");
        this.webPath = path.join(this.serverScriptPath, "client/web");

    };
    async parseConfUser(confPath="") {
        const confStr = await fs.readFile(confPath, "utf8");
        const confUser = JSON.parse(confStr);
        const valid = this.validate(confUser);
        if (!valid) {
            throw new Error("Invalid configuration: " + ajv.errorsText(this.validate.errors));
        }

        // set key and cert paths
        confUser["key"] = this.setAbsolute(confUser["key"], path.dirname(confPath));
        confUser["cert"] = this.setAbsolute(confUser["cert"], path.dirname(confPath));
        confUser["key"] = await fs.readFile(confUser["key"], {"encoding": "utf8"});
        confUser["cert"] = await fs.readFile(confUser["cert"], {"encoding": "utf8"});

        return confUser;
    };
    async compile(confSystem, confUser) {
        const isCompiled = await this.isDirEmpty(this.compilesPath, this.compilesSkipPaths) === false;
        // exit if compile is not requested and already compiled
        if (isCompiled && confSystem["isCompile"] === false) {
            return false;
        }

        //remove old compiled files
        await this.deletePath(this.compilesPath, true, this.compilesSkipPaths);

        const jobs = [];

        // read binaries (if exist in native libs)
        const nativeLibs = await fs.readdir(this.electronNativePath);
        const binList = await fs.readdir(this.binsPath);
        for (const bin of binList) {
            const binPath = path.join(this.binsPath, bin);
            const binInfo = path.basename(binPath, path.extname(binPath)).split("-");
            const binStat = await fs.stat(binPath);
            if (binInfo.length < 2) {
                continue;
            }
            const os = binInfo[0];
            const arch = binInfo[1];
            if (binStat.isDirectory() && binInfo.length === 2 && nativeLibs.includes(os + "-" + arch)) {
                jobs.push({
                    "path": binPath,
                    "os": os,
                    "arch": arch,
                    "isZip": false
                });
            } else if (binStat.isFile() && path.extname(binPath) === ".zip" && binInfo.length === 2 && nativeLibs.includes(os + "-" + arch)) {
                jobs.push({
                    "path": binPath,
                    "os": os,
                    "arch": arch,
                    "isZip": true
                });
            }
        }
        if (jobs.length === 0) {
            console.warn("No supported electron dist found in: " + sourcePath);
        }

        // generate conf script ()
        const confClient = {
            "domain": confUser["domain"],
            "port": confUser["port"],
            "webrtc": confUser["webrtc"],
            "clients": []
        };
        if (confUser["ws"] !== undefined) {
            confClient["ws"] = confUser["ws"];
        } else {
            confClient["ws"] = confUser["port"];
        }
        for (const job of jobs) {
            const name = job.os + "-" + job.arch + (job.isZip ? ".zip" : "");
            confClient["clients"].push(name);
        }
        let confString = JSON.stringify(confClient);

        // write generated conf into web path
        await fs.writeFile(path.join(this.webPath, "conf.json"), confString, "utf8");

        // create tmp directory
        await fs.mkdir(this.compilesPath, { "recursive": true });

        // pack electron binaries combined with web + electron app + native libs
        for (const job of jobs) {
            process.stdout.write("\n    Packing client for " + job.os + "-" + job.arch + "...    ");
            const zip = new JSZip();
            const zipName = job.os + "-" + job.arch + ".zip";

            // darwin uses Electron.app/Contents/Resources/app, others use resources/app
            const resourceAppPath = job.os === "darwin"
                ? "Electron.app/Contents/Resources/app"
                : "resources/app";

            // add electron binary dist
            if (job.isZip) {
                const zipData = await fs.readFile(job.path);
                const srcZip = await JSZip.loadAsync(zipData);
                for (const [relativePath, file] of Object.entries(srcZip.files)) {
                    if (!file.dir) {
                        zip.file(relativePath, await file.async("uint8array"));
                    }
                }
            } else {
                await this.addDirToZip(zip, job.path, "");
            }

            // add electron app files (main.js, package.json, libs/)
            await this.addDirToZip(zip, this.electronPath, resourceAppPath);

            // add web client files into resources/app/web
            await this.addDirToZip(zip, this.webPath, resourceAppPath);

            // add native libs for this platform
            const nativePath = path.join(this.electronNativePath, job.os + "-" + job.arch);
            await this.addDirToZip(zip, nativePath, resourceAppPath);

            // write final zip to downloads
            const zipBuffer = await zip.generateAsync({ "type": "nodebuffer" });
            await fs.writeFile(path.join(this.compilesPath, zipName), zipBuffer);

            process.stdout.write("done");
        }

        process.stdout.write("\n");
        return true;
    };

    setAbsolute(src, origin) {
        if (path.isAbsolute(src) === false) {
            src = path.join(origin, src);
        }
        return path.resolve(src);
    };

    async isDirEmpty(dirPath, skipPaths = []) {
        let stat;
        try {
            stat = await fs.stat(dirPath);
        } catch {
            return undefined;
        }

        if (!stat.isDirectory()) {
            return true;
        }

        const entries = await fs.readdir(dirPath);
        for (const entry of entries) {
            const relativePath = path.relative(dirPath, path.join(dirPath, entry)).split(path.sep).join("/");
            if (!skipPaths.includes(relativePath)) {
                return false;
            }
        }
        return true;
    };
    async deletePath(targetPath, keepDir, skipPaths = []) {
        const resolvedTarget = path.resolve(targetPath);
    
        let stat;
        try {
            stat = await fs.stat(resolvedTarget);
        } catch {
            return;
        }
        
        if (!stat.isDirectory()) {
            await fs.rm(resolvedTarget);
            return;
        }
    
        await this.deleteContents(resolvedTarget, resolvedTarget, skipPaths);
    
        if (!keepDir) {
            const remaining = await fs.readdir(resolvedTarget);
            if (remaining.length === 0) {
                await fs.rmdir(resolvedTarget);
            }
        }
    };
    async deleteContents(rootPath, currentPath, skipPaths) {
        const entries = await fs.readdir(currentPath);
    
        for (const entry of entries) {
            const entryPath = path.join(currentPath, entry);
            const relativePath = path.relative(rootPath, entryPath).split(path.sep).join("/");
    
            // Exact match — skip entirely
            if (skipPaths.includes(relativePath)) {
                continue;
            }
    
            // Check if this entry is a parent of any keepPath
            const isParentOfKept = skipPaths.some(
                (kp) => kp.startsWith(relativePath + "/")
            );
    
            if (isParentOfKept) {
                // Recurse into it but don't delete it
                await this.deleteContents(rootPath, entryPath, skipPaths);
            } else {
                await fs.rm(entryPath, { "recursive": true });
            }
        }
    };
    async copyDir(srcDir, destDir) {
        const entries = await fs.readdir(srcDir);
        for (const entry of entries) {
            const srcPath = path.join(srcDir, entry);
            const destPath = path.join(destDir, entry);
            const stat = await fs.stat(srcPath);
            if (stat.isDirectory()) {
                await fs.mkdir(destPath, { "recursive": true });
                await this.copyDir(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    };
    async addDirToZip(zip, dirPath, zipPrefix) {
        const entries = await fs.readdir(dirPath);
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry);
            const zipPath = zipPrefix ? zipPrefix + "/" + entry : entry;
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory()) {
                await this.addDirToZip(zip, fullPath, zipPath);
            } else {
                const data = await fs.readFile(fullPath);
                zip.file(zipPath, data);
            }
        }
    };
};

// websocket and http server
const Server = class {
    httpBasePath = "./src/client/web";
    httpDownloadPath = "./tmp/";
    httpServer = null;
    httpServerPort = null;
    httpRedirect = null;
    httpRedirectPort = null;
    
    wsServer = null;
    wsHttpServer = null;
    wsHttpServerPort = null;

    clients = new Map();    // key-clientId, value-> {ws, com, pairCode, joinId}
    pairs = new Map();      // key-pairCode, value-> {hostClientId, peerClientId, timeoutId}
    joins = new Map();      // key-joinId, value-> {peerCode, hostCode, peerUserId, hostUserId}

    isClosing = false;
    constructor() {
        
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
            let timeoutId = -1;
            stream.on("data", function() {
                //console.log("read");
                clearTimeout(timeoutId);
                timeoutId = setTimeout(function() {
                    data?.close?.();
                }, 10000);
            });
            stream.on("end", function() {
                //console.log("end");
                clearTimeout(timeoutId);
                data?.close?.();
            });
            
            return {
                "lastModified": date.toUTCString(),
                "type": mime.getMIMEType(path.extname(src)) || "text/plain",
                "size": stats.size,
                "etag": path.basename(src) + String(stats.size),
                "stream": stream
            };
        } catch (error) {
            return undefined;
        }
    };
    generateId(length=10, chars="1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
        let id = "";
        for (let i = 0; i < length; i++) {
            id += chars[Math.floor(Math.random() * chars.length)];
        }
        return id;
    };

    async start(confUser) {
        // Start HTTP server
        process.stdout.write("Starting HTTP server...    ");
        this.httpServerPort = confUser["port"];
        this.httpServer = https.createServer({
            "key": confUser["key"],
            "cert": confUser["cert"]
        }, this.httpRequestHandle.bind(this));
        this.httpServer.listen(this.httpServerPort);
        process.stdout.write("\n    Available: https://" + confUser["domain"] + (this.httpServerPort !== 443 ? ":" + this.httpServerPort : "") + "\n");
        
        // create redirect server
        if (confUser["redirect"] !== undefined) {
            this.httpRedirectPort = confUser["redirect"];
            this.httpRedirect = http.createServer(this.httpRedirectHandle.bind(this));
            this.httpRedirect.listen(this.httpRedirectPort);
            process.stdout.write("    Redirect: http://" + confUser["domain"] + (this.httpRedirectPort !== 80 ? ":" + this.httpRedirectPort : "") + "\n");
        }
        process.stdout.write("done\n");

        // Start WebSocket server
        process.stdout.write("Starting WS server...    ");
        if (confUser["ws"] !== undefined && confUser["ws"] !== confUser["port"]) {
            // create separate server for ws
            this.wsHttpServerPort = confUser["ws"];
            this.wsHttpServer = https.createServer({
                "key": confUser["key"],
                "cert": confUser["cert"]
            }, this.wsHttpHandle.bind(this));
            this.wsHttpServer.listen(this.wsHttpServerPort);
            this.wsServer = new WebSocketServer({
                "server": this.wsHttpServer
            });
        } else {
            // use existing http server for ws
            this.wsServer = new WebSocketServer({
                "server": this.httpServer
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
    };
    async stop() {
        if (this.isClosing) {
            return;
        }
        this.isClosing = true;
        
        // close WS server and its connections
        process.stdout.write("\n    Closing WS server....    ");
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
                const timeout = setTimeout(function() {
                    resolve(false);
                }, 5000);
                this.wsHttpServer.close(function() {
                    clearTimeout(timeout);
                    resolve(true);
                });
            });
        }
        process.stdout.write("done\n");

        // close redirect server if exists
        process.stdout.write("\n    Closing HTTP server....    ");
        if (this.httpRedirect !== null) {
            await new Promise((resolve) => {
                const timeout = setTimeout(function() {
                    resolve(false);
                }, 5000);
                this.httpRedirect.close(function() {
                    clearTimeout(timeout);
                   resolve(true);
                });
            });
        }
            
        // close HTTP server
        await new Promise((resolve) => {
            const timeout = setTimeout(function() {
                resolve(false);
            }, 5000);
            this.httpServer.close(function() {
                clearTimeout(timeout);
                resolve(true);
            });
        });
        process.stdout.write("done\n");

    };

    // server handlers
    async httpRequestHandle(req, res) {
        // get requested file
        let fileStream = undefined;
        if (req.url.startsWith("/downloads/")) {
            const fullPath = path.join(this.httpDownloadPath, req.url.replace("/downloads/", ""));
            fileStream = await this.getFileDataStream(fullPath);
        } else {
            const fullPath = path.join(this.httpBasePath, req.url);
            fileStream = await this.getFileDataStream(fullPath);
        }

        // get index.html if requesting root or index
        if (fileStream === undefined) {
            const fullPath = path.join(this.httpBasePath, "index.html");
            fileStream = await this.getFileDataStream(fullPath);
        }

        if (fileStream === undefined) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("404 Not Found");
            return;
        }

        res.writeHead(200, {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Last-Modified": fileStream["lastModified"],
            "Content-Length": fileStream["size"],
            "Content-Type": fileStream["type"],
            "ETag": fileStream["etag"]
        });
        fileStream["stream"].pipe(res);
    };
    async httpRedirectHandle(req, res) {
        const myURL = req.headers.host.split(":")[0];
        const myPort = this.httpServerPort !== 443 ? ":" + this.httpServerPort : "";
        res.writeHead(302, {
            "Location": "https://" + myURL + myPort + req.url
        });
        res.end();
    };
    async wsHttpHandle(req, res) {
        res.writeHead(200, {
            //"Content-Security-Policy": "default-src 'self'",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Length": 0,
            "Content-Type": "text/plain"
        });
        res.write("");
        res.end();
    };

    // websocket client handlers
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
        const client = {
            "ws": ws,
            "com": com,
            "pairCode": undefined,
            "joinId": undefined
        };
        this.clients.set(clientId, client);

        // listen messages and handle API
        com.onIncoming(async (messageObj) => {
            try {
                await this.handleAPI(messageObj, clientId);
            } catch (error) {
                console.log("Error handling message:", error);
                await client["ws"].terminate();
            }
        });

        // listen error
        ws.addEventListener("error", (event) => {
            console.log("Error " + event.error);
        });

        // listen close
        ws.addEventListener("close", () => {
            this.clientDisconnect(clientId);
        });

        // debug info
        console.log("Client connected (" + clientId.toString().padStart(4, "0") + ")");
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


        if (message["type"] === "ping") {
            /*{
                
            }*/
            /*{
                "success": boolean,
                "value": string
            }*/
            messageObj.send({
                "success": true,
                "value": "pong"
            });
            return;
        }

        if (message["type"] === "pair-create") {
            /*{

            }*/
            /*{
                "success": boolean,
                "pairCode": string
            }*/
            const pairCode = await this.pairCreate(clientId);
            messageObj.send({
                "success": true,
                "pairCode": pairCode
            });
            return;
        }

        if (message["type"] === "pair-request") {
            /*{
                "pairCode": string
            }*/
            /*{
                "success": boolean
                "ip": string,
            }*/
            const pairCode = message["pairCode"];
            const res = await this.pairRequest(clientId, pairCode);
            messageObj.send({
                "success": res["success"],
                "ip": res["success"] ? client["ws"]._socket.remoteAddress : undefined,
                "timeout": res["success"] ? res["timeout"] : undefined
            });
            return;
        }

        if (message["type"] === "pair-accept") {
            /*{

            }*/
            /*{
                "success": boolean,
                "joinCode": string,
                "hostCode": string
            }*/
            const pairCode = client["pairCode"];
            const pair = this.pairs.get(pairCode);
            if (pair === undefined) {
                messageObj.send({
                    "success": false
                });
                return;
            }
            const hostClientId = pair["hostClientId"];
            const peerClientId = pair["peerClientId"];
            if (hostClientId !== clientId) {
                messageObj.send({
                    "success": false
                });
                return;
            }
            
            const joinInfo = await this.joinCreate(hostClientId, peerClientId);
            if (joinInfo === undefined) {
                messageObj.send({
                    "success": false
                });
                return;
            }

            const peerClient = this.clients.get(peerClientId);
            const peerMessage = peerClient["com"].send({
                "type": "pair-accept",
                "joinId": joinInfo["joinId"],
                "peerCode": joinInfo["peerCode"]
            });
            await peerMessage.wait();

            messageObj.send({
                "success": true,
                "joinId": joinInfo["joinId"],
                "hostCode": joinInfo["hostCode"]
            });
            await messageObj.wait();
            return;
        }

        if (message["type"] === "pair-reject") {
            /*{

            }*/
            /*{
                "success": boolean,
            }*/
            const pairCode = client["pairCode"];
            const pair = this.pairs.get(pairCode);
            if (pair === undefined) {
                messageObj.send({
                    "success": true
                });
                return;
            }
            if (pair["hostClientId"] === clientId) {
                // reject request and notify peer
                await this.pairDelete(pairCode, false, true, false);
            } else if (pair["peerClientId"] === clientId) {
                // reject request and notify host
                await this.pairDelete(pairCode, false, false, true);
            }
            messageObj.send({
                "success": true
            });
            return;
        }

        if (message["type"] === "pair-delete") {
            /*{

            }*/
            /*{
                "success": boolean,
            }*/
            await this.pairDeleteByClientId(clientId);
             messageObj.send({
                "success": true
            });
            return;
        }


        if (message["type"] === "join-connect") {
            /*{
                "joinId": string,
                "code": string,
            }*/
            /*{
                "success": boolean,
            }*/
            const joinId = message["joinId"];
            const code = message["code"];
            if (joinId === undefined || code === undefined) {
                messageObj.send({
                    "success": false
                });
                return;
            }
            await this.joinConnect(clientId, joinId, code);
            messageObj.send({
                "success": true
            });
            return;
        }

        if (message["type"] === "join-request") {
            /*{
                "isInvoke": boolean,
                "value": string,
            }*/
            /*{
                "success": boolean,
                "value": boolean,
            }*/
            await this.joinRequest(clientId, messageObj);
            return;
        }

        if (message["type"] === "join-disconnect") {
            /*{

            }*/
            /*{
                "success": boolean,
            }*/
            this.joinDeleteByClientId(clientId);
            messageObj.send({
                "success": true
            });
            return;
        }
    };

    async pairCreate(clientId) {
        // delete old pair if exist
        this.pairDeleteByClientId(clientId);

        // create unique pair code
        let pairCode;
        do {
            pairCode = this.generateId(6, "0123456789");
        } while (this.pairs.has(pairCode));

        this.pairs.set(pairCode, {
            "hostClientId": clientId,
            "peerClientId": undefined,
            "timeoutId": undefined
        });
        const client = this.clients.get(clientId);
        client["pairCode"] = pairCode;
        console.log(this.pairs);
        return pairCode;
    };
    async pairRequest(clientId, pairCode) {
        // delete old pair if exist
        this.pairDeleteByClientId(clientId);

        // join peer to pair if exist
        const pair = this.pairs.get(pairCode);
        if (pair === undefined || pair["peerClientId"] !== undefined) {
            return {
                "success": false
            };
        }
        pair["peerClientId"] = clientId;
        const peerClient = this.clients.get(clientId);
        peerClient["pairCode"] = pairCode;

        // set timeout
        const timeout = 10000;
        pair["timeoutId"] = setTimeout(() => {
            this.pairDelete(pairCode, false, true, true);
        }, timeout + 2000);

        // send notification to host
        const hostClient = this.clients.get(pair["hostClientId"]);
        hostClient["com"].send({
            "type": "pair-request",
            "timeout": timeout,
            "ip": peerClient["ws"]._socket.remoteAddress
        });
        return {
            "success": true,
            "timeout": timeout
        };
    };
    async pairDeleteByClientId(clientId) {
        // filter clientId
        const client = this.clients.get(clientId);
        if (client === undefined || client["pairCode"] === undefined) {
            return;
        }

        // filter pair
        const pairCode = client["pairCode"];
        const pair = this.pairs.get(pairCode);
        if (pair === undefined) {
            client["pairCode"] = undefined;
            return;
        }

        // delete
        if (pair["hostClientId"] === clientId) {
            // remove peer with notification
            await this.pairDelete(pairCode, false, true, false);
            // remove host without notification
            await this.pairDelete(pairCode, true, false, false);
            
        } else if (pair["peerClientId"] === clientId) {
            // remove peer with notificate host
            await this.pairDelete(pairCode, false, false, true);
        } else {
            console.warn("Client " + clientId + " is not in pair " + pairCode);
        }
        console.log(this.pairs);

    };
    async pairDelete(pairCode, isHost, isNotify=false, isNotifyOther=false) {
        const pair = this.pairs.get(pairCode);
        if (pair === undefined) {
            return;
        }
        
        // delete host side
        if (isHost && pair["hostClientId"] !== undefined) {
            const hostClient = this.clients.get(pair["hostClientId"]);
            const peerClient = this.clients.get(pair["peerClientId"]);
            if (hostClient !== undefined) {
                hostClient["pairCode"] = undefined;
                if (isNotify) {
                    hostClient["com"].send({
                        "type": "pair-reject"
                    });
                }
                if (isNotifyOther) {
                    if (peerClient !== undefined) {
                        peerClient["com"].send({
                            "type": "pair-reject"
                        });
                    }
                }
            }
            if (peerClient !== undefined) {
                peerClient["pairCode"] = undefined;
            }
            // clear timeout
            if (pair["timeoutId"] !== undefined) {
                clearTimeout(pair["timeoutId"]);
                pair["timeoutId"] = undefined;
            }
            // delete pair
            this.pairs.delete(pairCode);
        }

        // delete peer side
        if (isHost === false && pair["peerClientId"] !== undefined) {
            const peerClient = this.clients.get(pair["peerClientId"]);
            if (peerClient !== undefined) {
                peerClient["pairCode"] = undefined;
                if (isNotify) {
                    peerClient["com"].send({
                        "type": "pair-reject"
                    });
                }
                if (isNotifyOther) {
                    const hostClient = this.clients.get(pair["hostClientId"]);
                    hostClient["com"].send({
                        "type": "pair-reject"
                    });
                }
            }
            // detete pair peer and timeout
            pair["peerClientId"] = undefined;
            if (pair["timeoutId"] !== undefined) {
                clearTimeout(pair["timeoutId"]);
                pair["timeoutId"] = undefined;
            }
        }

    };

    async joinCreate(hostClientId, peerClientId) {
        const hostClient = this.clients.get(hostClientId);
        const peerClient = this.clients.get(peerClientId);
        if (hostClient === undefined || peerClient === undefined) {
            return undefined;
        }

        // create unique join id
        let joinId;
        do {
            joinId = this.generateId(8);
        } while (this.joins.has(joinId));

        // create unique host code and peer code
        let hostCode, peerCode;
        do {
            hostCode = this.generateId(6);
            peerCode = this.generateId(6);
        } while (hostCode === peerCode);

        // set variables and return
        this.joins.set(joinId, {
            "hostClientId": hostClientId,
            "peerClientId": peerClientId,
            "hostCode": hostCode,
            "peerCode": peerCode
        });
        hostClient["joinId"] = joinId;
        peerClient["joinId"] = joinId;

        const pairCode = hostClient["pairCode"];
        await this.pairDelete(pairCode, false, false, false);
        await this.pairDelete(pairCode, true, false, false);

        return {
            "joinId": joinId,
            "hostCode": hostCode,
            "peerCode": peerCode
        };
    };
    async joinConnect(clientId, joinId, code) {
        // check client
        const client = this.clients.get(clientId);
        if (client === undefined) {
            return false;
        }
        // check join
        const join = this.joins.get(joinId);
        if (join === undefined) {
            return false;
        }
        // check code and get role
        let isHost;
        if (join["hostCode"] === code) {
            isHost = true;
        } else if (join["peerCode"] === code) {
            isHost = false;
        } else {
            return false;
        }
        
        // set client joinId
        client["joinId"] = joinId;

        // send notification to other side
        const otherClientId = isHost ? join["peerClientId"] : join["hostClientId"];
        const otherClient = this.clients.get(otherClientId);
        if (otherClient !== undefined) {
            otherClient["com"].send({
                "type": "join-connect",
            });
        }
        return true;
    };
    async joinRequest(clientId, messageObj) {
        // check client
        const client = this.clients.get(clientId);
        if (client === undefined) {
            return false;
        }
        // check join
        const joinId = client["joinId"];
        const join = this.joins.get(joinId);
        if (join === undefined) {
            return false;
        }
        const otherClientId = join["hostClientId"] === clientId ? join["peerClientId"] : join["hostClientId"];
        const otherClient = this.clients.get(otherClientId);
        if (otherClient === undefined) {
            return false;
        }

        const otherMessageObj = otherClient["com"].send({
            "type": "join-request",
            "value": messageObj.data["value"]
        });

        if (otherMessageObj.error !== "") {
            messageObj.send({
                "success": false
            });
            return;
        }
        messageObj.send({
            "success": true,
        });
    };
    async joinDisconnectByClientId(clientId) {
        // filter clientId
        const client = this.clients.get(clientId);
        if (client === undefined || client["joinId"] === undefined) {
            return;
        }
        const joinId = client["joinId"];
        const join = this.joins.get(joinId);
        if (join === undefined) {
            client["joinId"] = undefined;
            return;
        }
        if (join["hostClientId"] === clientId) {
            // delete host with notification and notify peer
            await this.joinDelete(joinId, true, false, true, "join-disconnect");
        } else if (join["peerClientId"] === clientId) {
            // delete peer with notification and notify host
            await this.joinDelete(joinId, false, false, true, "join-disconnect");
        }
    };
    async joinDeleteByClientId(clientId) {
        // filter clientId
        const client = this.clients.get(clientId);
        if (client === undefined || client["joinId"] === undefined) {
            return;
        }
        const joinId = client["joinId"];
        const join = this.joins.get(joinId);
        if (join === undefined) {
            client["joinId"] = undefined;
            return;
        }
        if (join["hostClientId"] === clientId) {
            // delete host with notification and notify peer
            await this.joinDelete(joinId, false, false, true, "join-delete");
            await this.joinDelete(joinId, true, false, true, "join-delete");
        } else if (join["peerClientId"] === clientId) {
            // delete peer with notification and notify host
            await this.joinDelete(joinId, false, false, true, "join-delete");
            await this.joinDelete(joinId, true, false, true, "join-delete");
        }
    };
    async joinDelete(joinId, isHost, isNotify=false, isNotifyOther=false, type="join-disconnect") {
        const join = this.joins.get(joinId);
        if (join === undefined) {
            return;
        }

        // delete host side
        if (isHost && join["hostClientId"] !== undefined) {
            const hostClient = this.clients.get(join["hostClientId"]);
            if (hostClient !== undefined) {
                hostClient["joinId"] = undefined;
                if (isNotify) {
                    hostClient["com"].send({
                        "type": type
                    });
                }
                const peerClient = this.clients.get(join["peerClientId"]);
                if (isNotifyOther && peerClient !== undefined) {
                    peerClient["com"].send({
                        "type": type
                    });
                }
            }
        }

        // delete peer side
        if (isHost === false && join["peerClientId"] !== undefined) {
            const peerClient = this.clients.get(join["peerClientId"]);
            if (peerClient !== undefined) {
                peerClient["joinId"] = undefined;
                if (isNotify) {
                    peerClient["com"].send({
                        "type": type
                    });
                }
                const hostClient = this.clients.get(join["hostClientId"]);
                if (isNotifyOther && hostClient !== undefined) {
                    hostClient["com"].send({
                        "type": type
                    });
                }
            }
        }

        if (join["hostClientId"] === undefined || join["peerClientId"] === undefined) {
            this.joins.delete(joinId);
        }

        return;
    };
    
    async clientDisconnect(clientId) {
        this.pairDeleteByClientId(clientId);
        this.joinDisconnectByClientId(clientId);
        this.clients.delete(clientId);
        console.log("Client disconnected (" + clientId + ")");
    };
};


const main = async function(args) {
    const configure = new Configure();
    const server = new Server();

    // Read CLI options
    process.stdout.write("Reading arguments...    ");
    const confPath = path.resolve(getArg(args, "--configuration", true, true) || getArg(args, "-c", true, false) || "./conf/conf.json");
    const complieFlag = getArg(args, "--compile", false) || false;
    const exitFlag = getArg(args, "--exit", false) || false;
    process.stdout.write("done\n");
    
    // Process the configuration and parameters
    process.stdout.write("Load the configuration...    ");
    const confSystem = {};
    confSystem["isCompile"] = complieFlag;
    confSystem["isExit"] = exitFlag;
    const confUser = await configure.parseConfUser(confPath);
    process.stdout.write("done\n");

    // Compile the clients
    process.stdout.write("Compiling clients...    ");
    const isCompiled = await configure.compile(confSystem, confUser);
    if (isCompiled) {
        process.stdout.write("done\n");
    } else {
        process.stdout.write("skipped\n");
    }
    

    // Start HTTP/WS server
    await server.start(confUser);

    // Cleanup
    const close = async function() {
        process.stdout.write("Exiting....    ");
        await server.stop();
        process.stdout.write("done\n");
        process.exit(0); 
    };
    process.stdout.write("Press CTRL+C to stop servers\n");
    process.on("SIGTERM", async function() {
        process.stdout.write("SIGTERM signal received\n");
        await close();
    });
    process.on("SIGINT", async function() {
        process.stdout.write("SIGINT signal received\n");
        await close();
    });
    if (confSystem["isExit"]) {
        process.stdout.write("--exit flag received\n");
        await close();
    }
};
main(process.argv);