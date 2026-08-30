"use strict";

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";

// first-party dependencies 
import Mime from "./mime.js";
import { binarySearch } from "./common.js";

// client version is the project version
// TODO: move to a shared constants module (src/server/building.js needs it too)
const packageJsonPath = path.resolve(import.meta.dirname, "../../package.json");
const CLIENT_VERSION = JSON.parse(await fs.readFile(packageJsonPath, "utf8"))["version"];

const ServerHTTP = class {
    httpBasePath = "./src/client/web";
    httpDownloadPath = "./tmp";
    httpServer = null;
    httpPort = 443;
    httpCache = new Map();
    httpCacheSize = 0;
    httpCacheSizeLimit = 0;
    httpCacheUpdate = 1000;
    httpCacheUpdateLength = 5;
    httpCacheUpdateId = -1;
    httpCacheReloadId = -1;
    httpRedirect = null;

    constructor() {

    };

    // file getters
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

    // HTTP GET requests
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

    // resolve the requested path inside a base path (undefined if it escapes it)
    resolveInBase(basePath, filePath) {
        const base = path.resolve(basePath);
        const full = path.resolve(base, filePath);
        if (full !== base && full.startsWith(base + path.sep) === false) {
            return undefined;
        }
        return full;
    };

    

    async buildChache() {
        // download path first, so the web files win on name collision
        const basePaths = [this.httpDownloadPath, this.httpBasePath];
        this.httpCache = new Map();
        for (const basePath of basePaths) {
            const files = await fs.readdir(basePath, {"recursive": true});
            for (const file of files) {
                const src = path.join(basePath, file);
                const stats = await fs.stat(src);
                if (stats.isFile() === false) {
                    continue; // skip directories
                }
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
    };

    async refreshCache() {
        // fill with priority order small -> high (smaller is better)
        const priorityOrder = [];
        const it = this.httpCache.entries();
        for (const [key, val] of it) {
            if (val["size"] > this.httpCacheSizeLimit) {
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
    };

    httpsRequestHandler = async (req, res) => {
        const basePaths = [this.httpBasePath, this.httpDownloadPath];
        const filePath = req.url.slice(1);          // remove start slash

        // get requested file
        let fileData;
        for (const basePath of basePaths) {
            const fullPath = this.resolveInBase(basePath, filePath);
            if (typeof fullPath === "undefined") {
                continue; // outside of the served folder
            }
            fileData = await this.getFileDataStream(fullPath);
            if (typeof fileData !== "undefined") {
                break; // found
            }
        }
        // get default file if not found
        if (typeof fileData === "undefined") {
            fileData = await this.getFileDataStream(path.join(basePaths[0], "index.html"));
        }
        if (typeof fileData === "undefined") {
            res.writeHead(404);
            res.end();
            return;
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

    httpsRequestHandlerWithCache = async (req, res) => {
        const filePath = req.url.slice(1);          // remove start slash

        // check existence of file
        let fileData = this.httpCache.get(filePath);
        if (typeof fileData === "undefined") {
            fileData = this.httpCache.get("index.html");
        }
        if (typeof fileData === "undefined") {
            res.writeHead(404);
            res.end();
            return;
        }

        // add access to statistics
        fileData["accesses"][0] += 1;
        fileData["accessed"] += 1;

        // check if file is in memory cache
        if (typeof fileData["buffer"] === "undefined") {
            // read from disk if not in memory
            const file = await this.getFileDataStream(fileData["path"]);
            if (typeof file === "undefined") {
                res.writeHead(404);
                res.end();
                return;
            }
            res.writeHead(200, {
                //"Content-Security-Policy": "default-src 'self'",
                "Last-Modified": fileData["lastModified"],
                "Content-Length": fileData["size"],
                "Content-Type": fileData["type"]
            });
            file["stream"].pipe(res);
        } else {
            res.writeHead(200, {
                //"Content-Security-Policy": "default-src 'self'",
                "Last-Modified": fileData["lastModified"],
                "Content-Length": fileData["size"],
                "Content-Type": fileData["type"]
            });
            res.write(fileData["buffer"]);
            res.end();
        }
    };

    httpRedirectHandler = (req, res) => {
        const myURL = req.headers.host.split(":")[0];
        const myPort = this.httpPort !== 443 ? ":" + this.httpPort : "";
        res.writeHead(302, {
            "Location": "https://" + myURL + myPort + req.url
        });
        res.end();
    };

    // behavior methods
    async start(conf) {
        process.stdout.write("Starting HTTP server...    ");
        if (typeof conf["http"] !== "object") {
            process.stdout.write("skipped\n");
            return;
        }

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
            requestHandle = this.httpsRequestHandler;
        } else {
            // build cache
            this.httpCacheSize = conf["http"]["cache"]["size"];
            this.httpCacheSizeLimit = conf["http"]["cache"]["sizeLimit"];
            await this.buildChache();

            // update access stats periodically
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
                await this.refreshCache();
            }, this.httpCacheUpdate * this.httpCacheUpdateLength);

            requestHandle = this.httpsRequestHandlerWithCache;
        }

        // create HTTP server
        this.httpPort = conf["http"]["port"];
        this.httpServer = https.createServer({
            "key": conf["http"]["key"],
            "cert": conf["http"]["cert"]
        }, requestHandle);
        this.httpServer.listen(this.httpPort);
        process.stdout.write("\n    Available: https://" + conf["http"]["domain"] + (conf["http"]["port"] !== 443 ? ":" + conf["http"]["port"] : "") + "\n");

        // create redirect server
        if (typeof conf["http"]["redirect"] !== "undefined") {
            this.httpRedirect = http.createServer(this.httpRedirectHandler);
            this.httpRedirect.listen(conf["http"]["redirect"]);
            process.stdout.write("    Redirect: http://" + conf["http"]["domain"] + (conf["http"]["redirect"] !== 80 ? ":" + conf["http"]["redirect"] : "") + "\n");
        }
        process.stdout.write("done\n");
    };

    async stop() {
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
                this.httpRedirect = null;
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
            this.httpServer = null;
            process.stdout.write("done\n");
        } else {
            process.stdout.write("skipped\n");
        }

        // stop cache maintenance
        clearInterval(this.httpCacheUpdateId);
        this.httpCacheUpdateId = -1;
        clearInterval(this.httpCacheReloadId);
        this.httpCacheReloadId = -1;

        // clear cache
        this.httpCache.clear();
    };
};

export default { ServerHTTP };
