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
import { getMIMEType } from "./mime.js";
import { binarySearch } from "./common.js";

// the folders holding the client assets, everything else is an SPA route
const ASSET_FOLDERS = new Set(["src", "ui", "libs", "media"]);

const ServerHTTP = class {
    httpBasePath = "./tmp/web";
    httpDownloadPath = "./tmp/desktop";
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
                "type": getMIMEType(path.extname(src)) || "text/plain",
                "size": stats.size,
                "etag": "\"" + path.basename(src) + String(stats.size) + "\"",
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

            //close when finished, destroyed or inactive
            let timeOut = -1;
            const closeHandle = function() {
                clearTimeout(timeOut);
                data?.close?.()?.catch?.(function() {});
            };
            stream.on("data", function() {
                clearTimeout(timeOut);
                timeOut = setTimeout(closeHandle, 10000);
            });
            stream.once("close", closeHandle);

            return {
                "lastModified": date.toUTCString(),
                "type": getMIMEType(path.extname(src)) || "text/plain",
                "size": stats.size,
                "etag": "\"" + path.basename(src) + String(stats.size) + "\"",
                "stream": stream
            };
        } catch (error) {
            return undefined;
        }
    };

    // bind a server to a port, a failed bind arrives as an "error" event and
    // would take the process down instead of reaching the caller of start()
    listen(server, port) {
        return new Promise((resolve, reject) => {
            const onError = function(error) {
                reject(new Error("Cannot listen on port " + port + " - " + error.message));
            };
            server.once("error", onError);
            server.listen(port, function() {
                server.removeListener("error", onError);
                resolve();
            });
        });
    };

    // the file a request asks for: no query, no hash, decoded, "/" separated
    requestPath(url) {
        let filePath = url.split("?")[0].split("#")[0];
        try {
            filePath = decodeURIComponent(filePath);
        } catch (error) {
            // not a valid percent encoding, serve it as it arrived
        }
        while (filePath.startsWith("/")) {
            filePath = filePath.slice(1);
        }
        return filePath;
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

    // the SPA fallback is for routes only: a missing asset has to stay a 404, or
    // a mistyped import() specifier arrives as index.html with a text/html type
    // and fails with an opaque MIME error instead of a plain missing file
    isRoutePath(filePath) {
        if (filePath === "") {
            return true;
        }
        if (path.extname(filePath) !== "") {
            return false;
        }
        return ASSET_FOLDERS.has(filePath.split("/")[0]) === false;
    };

    // the client already holds this exact version of the file
    isNotModified(req, fileData) {
        const noneMatch = req.headers["if-none-match"];
        if (typeof noneMatch === "string") {
            for (const tag of noneMatch.split(",")) {
                if (tag.trim() === fileData["etag"] || tag.trim() === "*") {
                    return true;
                }
            }
            return false;   // an explicit ETag that does not match wins over the date
        }
        const since = Date.parse(req.headers["if-modified-since"]);
        if (Number.isNaN(since) === false) {
            return Date.parse(fileData["lastModified"]) <= since;
        }
        return false;
    };

    // the headers every answer carries, so both handlers cache the same way
    fileHeaders(fileData) {
        return {
            //"Content-Security-Policy": "default-src 'self'",
            "Cache-Control": "no-cache",
            "Last-Modified": fileData["lastModified"],
            "Content-Length": fileData["size"],
            "Content-Type": fileData["type"],
            "ETag": fileData["etag"]
        };
    };

    

    async buildChache() {
        // download path first, so the web files win on name collision
        const basePaths = [this.httpDownloadPath, this.httpBasePath];
        this.httpCache = new Map();
        for (const basePath of basePaths) {
            const files = await fs.readdir(basePath, {"recursive": true});
            for (const file of files) {
                if (basePath === this.httpDownloadPath && path.extname(file).toLowerCase() !== ".zip") {
                    continue; // only the client zips are downloadable
                }
                const src = path.join(basePath, file);
                const stats = await fs.stat(src);
                if (stats.isFile() === false) {
                    continue; // skip directories
                }
                const date = new Date(stats.mtimeMs);
                this.httpCache.set(file.split(path.sep).join("/"), {
                    "path": src,
                    "lastModified": date.toUTCString(),
                    "type": getMIMEType(path.extname(src)) || "text/plain",
                    "size": stats.size,
                    "etag": "\"" + path.basename(src) + String(stats.size) + "\"",
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
        const filePath = this.requestPath(req.url);

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
        // a route falls back to the shell, a missing asset stays missing
        if (typeof fileData === "undefined" && this.isRoutePath(filePath) === true) {
            fileData = await this.getFileDataStream(path.join(basePaths[0], "index.html"));
        }
        if (typeof fileData === "undefined") {
            res.writeHead(404);
            res.end();
            return;
        }
        if (this.isNotModified(req, fileData) === true) {
            fileData["stream"].destroy();
            res.writeHead(304, this.fileHeaders(fileData));
            res.end();
            return;
        }
        res.writeHead(200, this.fileHeaders(fileData));
        fileData["stream"].pipe(res);
    };

    httpsRequestHandlerWithCache = async (req, res) => {
        const filePath = this.requestPath(req.url);

        // check existence of file, a route falls back to the shell
        let fileData = this.httpCache.get(filePath);
        if (typeof fileData === "undefined" && this.isRoutePath(filePath) === true) {
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

        if (this.isNotModified(req, fileData) === true) {
            res.writeHead(304, this.fileHeaders(fileData));
            res.end();
            return;
        }

        // check if file is in memory cache
        if (typeof fileData["buffer"] === "undefined") {
            // read from disk if not in memory
            const file = await this.getFileDataStream(fileData["path"]);
            if (typeof file === "undefined") {
                res.writeHead(404);
                res.end();
                return;
            }
            res.writeHead(200, this.fileHeaders(fileData));
            file["stream"].pipe(res);
        } else {
            res.writeHead(200, this.fileHeaders(fileData));
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

        // This server writes nothing into what it serves: index.json is part of
        // a build, written once by buildConfFile for the web client and every
        // desktop zip alike. A boot that wrote it again would hand the browser a
        // version the build never produced, and the client would fail its
        // version check against a server it is in fact the client of.

        // create HTTP server request handler
        let requestHandle = null;
        if (typeof conf["http"]["cache"] !== "object") {
            requestHandle = this.httpsRequestHandler;
        } else {
            // build cache
            this.httpCacheSize = conf["http"]["cache"]["size"];
            this.httpCacheSizeLimit = conf["http"]["cache"]["fileSizeLimit"];
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
        await this.listen(this.httpServer, this.httpPort);
        process.stdout.write("\n    Available: https://" + conf["http"]["domain"] + (conf["http"]["port"] !== 443 ? ":" + conf["http"]["port"] : "") + "\n");

        // create redirect server
        if (typeof conf["http"]["redirect"] !== "undefined") {
            this.httpRedirect = http.createServer(this.httpRedirectHandler);
            await this.listen(this.httpRedirect, conf["http"]["redirect"]);
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

// the server is a singleton, the module hands out the running instance
const serverHTTP = new ServerHTTP();

export { serverHTTP };
export default serverHTTP;
