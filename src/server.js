"use strict";

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import buffer from "node:buffer";

// third-party dependenciess
import JSZip from "jszip";
import { WebSocketServer } from "ws";

// first-party dependencies
import Mime from "easy-mime";
import Communicator from "easy-communicator";

const CLIENT_VERSION = "0.1.0";
const MIN_CLIENT_VERSION = CLIENT_VERSION;

//
// Helper functions
//

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

// check if dir is empty
const isDirEmpty = async function(dirPath) {
    try {
        const dirIter = await fs.opendir(dirPath);
        const {value, done} = await dirIter[Symbol.asyncIterator]().next();
        if (!done) {
            await dirIter.close();
            return true;
        }
        return false;
    } catch (error) {
        return undefined;
    }
};

// this will join path if relative
const setAbsolute = function(src, origin) {
    if (path.isAbsolute(src) === false) {
        src = path.join(origin, src);
    }
    return path.resolve(src);
};

//
// Logic
//
const serverScriptPath = import.meta.dirname;

// proceed the conf file fields
const processConf = async function(confPath) {
    //console.log(confPath);

    // load conf file (required)
    const contents = await fs.readFile(confPath, {
        "encoding": "utf8"
    });
    let confIn = {};
    let confOut = {};
    try {
        confIn = JSON.parse(contents);
        if (typeof confIn !== "object") {
            throw new Error("Invalid JSON format!");
        }
    } catch (error) {
        throw new Error("Invalid configuration file: " + error.message);
    }
    
    // check HTTP settings
    if (typeof confIn["http"] === "object") {
        confOut["http"] = {};

        // check domain
        if (typeof confIn["http"]["domain"] !== "string" || confIn["http"]["domain"].length === 0) {
            throw new Error("Invalid HTTP domain: " + confIn["http"]["domain"]);
        }
        confOut["http"]["domain"] = confIn["http"]["domain"];

        // check port
        if (typeof confIn["http"]["port"] !== "number" || confIn["http"]["port"] < 1 || confIn["http"]["port"] > 65535) {
            throw new Error("Invalid HTTP port: " + confIn["http"]["port"]);
        }
        confOut["http"]["port"] = confIn["http"]["port"];

        // check key
        if (typeof confIn["http"]["key"] !== "string") {
            throw new Error("Invalid HTTP key path: " + confIn["http"]["key"]);
        }
        try {
            const keyPath = setAbsolute(confIn["http"]["key"], path.dirname(confPath));
            confOut["http"]["key"] = await fs.readFile(keyPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid HTTP key path: " + confIn["http"]["key"] + " - " + error.message);
        }

        // check cert
        if (typeof confIn["http"]["cert"] !== "string") {
            throw new Error("Invalid HTTP cert path: " + confIn["http"]["cert"]);
        }
        try {
            const certPath = setAbsolute(confIn["http"]["cert"], path.dirname(confPath));
            confOut["http"]["cert"] = await fs.readFile(certPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid HTTP cert path: " + confIn["http"]["cert"] + " - " + error.message);
        }

        // check redirect (optional)
        if (typeof confIn["http"]["redirect"] === "number") {
            if (confIn["http"]["redirect"] < 1 || confIn["http"]["redirect"] > 65535 || confIn["http"]["redirect"] === confIn["http"]["port"]) {
                throw new Error("Invalid HTTP redirect port: " + confIn["http"]["redirect"]);
            }
            confOut["http"]["redirect"] = confIn["http"]["redirect"];
        }

        // check cache (optional)
        if (typeof confIn["http"]["cache"] === "object") {
            confOut["http"]["cache"] = {};
            // check size
            if (typeof confIn["http"]["cache"]["size"] !== "number" || confIn["http"]["cache"]["size"] < 0) {
                throw new Error("Invalid HTTP cache size: " + confIn["http"]["cache"]["size"]);
            }
            confOut["http"]["cache"]["size"] = confIn["http"]["cache"]["size"];
            // check sizeLimit
            if (typeof confIn["http"]["cache"]["sizeLimit"] !== "number" || confIn["http"]["cache"]["sizeLimit"] < 0) {
                throw new Error("Invalid HTTP cache sizeLimit: " + confIn["http"]["cache"]["sizeLimit"]);
            }
            if (confIn["http"]["cache"]["sizeLimit"] > confIn["http"]["cache"]["size"]) {
                throw new Error("HTTP cache sizeLimit cannot be greater than cache size!");
            }
            confOut["http"]["cache"]["sizeLimit"] = confIn["http"]["cache"]["sizeLimit"];
        }

        // check remote (optional)
        if (typeof confIn["http"]["remote"] === "object") {
            confOut["http"]["remote"] = {};
            // check host
            if (typeof confIn["http"]["remote"]["host"] !== "string" || confIn["http"]["remote"]["host"].length === 0) {
                throw new Error("Invalid HTTP remote host: " + confIn["http"]["remote"]["host"]);
            }
            confOut["http"]["remote"]["host"] = confIn["http"]["remote"]["host"];
            // check port
            if (typeof confIn["http"]["remote"]["port"] !== "number" || confIn["http"]["remote"]["port"] < 1 || confIn["http"]["remote"]["port"] > 65535) {
                throw new Error("Invalid HTTP remote port: " + confIn["http"]["remote"]["port"]);
            }
            confOut["http"]["remote"]["port"] = confIn["http"]["remote"]["port"];
        }
    }


    // check WS settings
    if (typeof confIn["ws"] === "object") {
        confOut["ws"] = {};

        // check port
        if (typeof confIn["ws"]["port"] !== "number" || confIn["ws"]["port"] < 1 || confIn["ws"]["port"] > 65535) {
            throw new Error("Invalid WS port: " + confIn["ws"]["port"]);
        }
        if (confIn["ws"]["port"] === confOut?.["http"]?.["redirect"]) {
            throw new Error("WS port cannot be the same as HTTP redirect port!");
        }
        confOut["ws"]["port"] = confIn["ws"]["port"];

        // check key (only if no using HTTP server)
        if (confOut["ws"]["port"] !== confIn?.["http"]?.["port"]) {
            if (typeof confIn["ws"]["key"] !== "string") {
                throw new Error("Invalid WS key path: " + confIn["ws"]["key"]);
            }
            try {
                const keyPath = setAbsolute(confIn["ws"]["key"], path.dirname(confPath));
                confOut["ws"]["key"] = await fs.readFile(keyPath, {
                    "encoding": "utf8"
                });
            } catch (error) {
                throw new Error("Invalid WS key path: " + confIn["ws"]["key"] + " - " + error.message);
            }
        }

        // check cert
        if (typeof confIn["ws"]["cert"] !== "string") {
            throw new Error("Invalid WS cert path: " + confIn["ws"]["cert"]);
        }
        try {
            const certPath = setAbsolute(confIn["ws"]["cert"], path.dirname(confPath));
            confOut["ws"]["cert"] = await fs.readFile(certPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid WS cert path: " + confIn["ws"]["cert"] + " - " + error.message);
        }

        // check SQL
        if (typeof confIn["ws"]["sql"] !== "object") {
            throw new Error("Invalid WS SQL configuration: " + confIn["ws"]["sql"]);
        }
        confOut["ws"]["sql"] = {};

        // check SQL host
        if (typeof confIn["ws"]["sql"]["host"] !== "string" || confIn["ws"]["sql"]["host"].length === 0) {
            throw new Error("Invalid WS SQL host: " + confIn["ws"]["sql"]["host"]);
        }
        confOut["ws"]["sql"]["host"] = confIn["ws"]["sql"]["host"];

        // check SQL port
        if (typeof confIn["ws"]["sql"]["port"] !== "number" || confIn["ws"]["sql"]["port"] < 1 || confIn["ws"]["sql"]["port"] > 65535) {
            throw new Error("Invalid WS SQL port: " + confIn["ws"]["sql"]["port"]);
        }
        confOut["ws"]["sql"]["port"] = confIn["ws"]["sql"]["port"];

        // check SQL user
        if (typeof confIn["ws"]["sql"]["user"] !== "string") {
            throw new Error("Invalid WS SQL user: " + confIn["ws"]["sql"]["user"]);
        }
        confOut["ws"]["sql"]["user"] = confIn["ws"]["sql"]["user"];

        // check SQL password
        if (typeof confIn["ws"]["sql"]["pass"] !== "string") {
            throw new Error("Invalid WS SQL password: " + confIn["ws"]["sql"]["pass"]);
        }
        confOut["ws"]["sql"]["pass"] = confIn["ws"]["sql"]["pass"];
    }


    // check HTTP and WS constraints
    if (typeof confOut["http"] !== "object" && typeof confOut["ws"] !== "object") {
        throw new Error("At least one of HTTP or WS configuration must be provided!");
    }
    if (typeof confOut["http"] === "object" && typeof confOut["http"]["remote"] !== "object" && typeof confOut["ws"] !== "object") {
        throw new Error("HTTP remote configuration must be provided if no local WS server in configuration!");
    }
    if (typeof confOut["ws"] === "object" && typeof confOut["http"]["remote"] === "object") {
        throw new Error("WS server cannot be created if HTTP remote is configured!");
    }

    return confOut;
};

// comlile the desktop clients
const compileClients = async function(conf) {
    // check conf
    if (typeof conf["http"] !== "object") {
        throw new Error("HTTP configuration is required for client compilation!");
    }

    // secure compile path
    const compilePath = "./tmp";
    let isCompiled = false;
    try {
        await fs.access(compilePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
        // create compile path if not exists
        try {
            await fs.mkdir(compilePath, { recursive: true });
        } catch (error) {
            throw new Error("Cannot create compile path: " + compilePath + " - " + error.message);
        }
    }

    // check existing compiled files
    isCompiled = await isDirEmpty(compilePath);

    // exit if compile is not requested and already compiled
    if (conf["flags"]["compile"] === false && isCompiled) {
        return false;
    }

    //remove old compiled files
    for (const file of await fs.readdir(compilePath)) {
        await fs.rm(path.join(compilePath, file), { recursive: true, force: true });
    }

    // read electron dist
    const electronDistPath = path.join(serverScriptPath, "client", "electron", "dist");
    const dists = [];
    try {
        const elements = await fs.readdir(electronDistPath);
        for (const element of elements) {
            const elementPath = path.join(electronDistPath, element);
            const isDir = (await fs.stat(elementPath)).isDirectory();
            if (isDir && element.split("-").length === 2) {
                dists.push([elementPath, element]);
            }
        }
    }
    catch (error) {
        console.error("Cannot read electron dist path: " + electronDistPath + " - " + error.message);
        return false;
    }
    if (dists.length === 0) {
        console.error("No electron dist found in: " + electronDistPath);
        return false;
    }

    // generate conf script
    const confData = {
        "http": {
            "domain": conf["http"]["domain"],
            "port": conf["http"]["port"],
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

    // read web files
    const webPath = path.join(serverScriptPath, "client", "web");
    const webFiles = await fs.readdir(webPath, {"recursive": true});

    // go through the dists
    const commonPath = path.join(serverScriptPath, "client", "electron", "common");
    for (const [distPath, distName] of dists) {
        const system = distName.split("-")[0];
        const arch = distName.split("-")[1];
        process.stdout.write("\n    Compiling " + distName + "...    ");

        // create the zips
        const zip = new JSZip();

        // go through dist files
        const distFiles = await fs.readdir(distPath, {"recursive": true});
        for (const file of distFiles) {
            const filePath = path.join(distPath, file);
            const isDir = (await fs.stat(filePath)).isDirectory();
            if (isDir) {
                zip.folder(file);
            } else {
                const fileContents = await fs.readFile(filePath);
                zip.file(file, fileContents);
            }
        }
        
        // go through common files
        const commonFiles = await fs.readdir(commonPath, {"recursive": true});
        let commonDest = path.join("resources", "app");
        if (system === "macos") {
            commonDest = path.join("Electron.app", "Contents", "Resources", "app");
        }
        for (const file of webFiles) {
            const filePath = path.join(webPath, file);
            const isDir = (await fs.stat(filePath)).isDirectory();
            if (isDir) {
                zip.folder(path.join(commonDest, file));
            } else {
                const fileContents = await fs.readFile(filePath);
                zip.file(path.join(commonDest, file), fileContents);
            }
        }
        for (const file of commonFiles) {
            const filePath = path.join(commonPath, file);
            const isDir = (await fs.stat(filePath)).isDirectory();
            if (isDir) {
                zip.folder(path.join(commonDest, file));
            } else {
                const fileContents = await fs.readFile(filePath);
                zip.file(path.join(commonDest, file), fileContents);
            }
        }

        // add conf file
        zip.file(path.join(commonDest, "conf.js"), confScript);

        // save the zip file
        const buff = await zip.generateAsync({"type" : "uint8array"});
        const zipFileName =  system + "-" + arch + ".zip";
        const zipFilePath = path.join(compilePath, zipFileName);
        try {
            await fs.writeFile(zipFilePath, buff);
        } catch (error) {
            process.stdout.write("error\n");
            continue;
        }
        process.stdout.write("done");
    }
    process.stdout.write("\n");
    return true;
    
};

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
    clients = new Map();

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
                        //"Content-Security-Policy": "default-src 'self'",
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

                    // check file in file set cache
                    if (this.httpCache.has(filePath) === false) {
                        filePath = "index.html"; 
                    }

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
                        res.end(); //end the response
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
    async clientConnect(ws) {
        let clientId;
        do {
            clientId = (Math.floor(Math.random() * 9999) + 1).toString().padStart(4, "0");
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
            let data = event.data;
            try {
                if (buffer.isUtf8(data)) {
                    data = data.toString("utf8");
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
        this.clients.set(clientId, com);
        console.log("Client connected (" + clientId + ")");

        // listen error
        ws.addEventListener("error", (event) => {
            console.log("Error " + event.error);
        });

        // listen close
        ws.addEventListener("close", () => {
            console.log("Client disconnected (" + clientId + ")");
            this.clients.delete(clientId);
        });


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


//
// Main
//
const main = async function(args) {
    // Read CLI options
    process.stdout.write("Reading arguments...    ");
    const confPath = path.resolve(getArg(process.argv, "--configuration", true, true) || getArg(process.argv, "-c", true, false) || "./conf/conf.json");
    const complieFlag = getArg(process.argv, "--compile", false) || false;
    const exitFlag = getArg(process.argv, "--exit", false) || false;
    process.stdout.write("done\n");

    
    // Process the configuration and parameters
    process.stdout.write("Load the configuration...    ");
    const conf = await processConf(confPath);
    conf["flags"] = {};
    conf["flags"]["compile"] = complieFlag;
    conf["flags"]["exit"] = exitFlag;
    process.stdout.write("done\n");


    // Compile the clients
    process.stdout.write("Compiling clients...    ");
    const isDone = await compileClients(conf);
    if (isDone) {
        process.stdout.write("done\n");
    } else {
        process.stdout.write("skipped\n");
    }

    // Start HTTP/WS server
    const server = new Server();
    await server.start(conf);

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
    if (conf["flags"]["exit"]) {
        process.stdout.write("--exit flag received\n");
        await close();
    }
};
main(process.argv);