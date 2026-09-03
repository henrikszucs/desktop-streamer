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

// a host name worth echoing into a Location: a name, an IPv4, or a bracketed IPv6
const HOST_NAME = /^(?:[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*|\[[0-9A-Fa-f:.]{2,45}\])$/;

// the download folder hands out the built client zips and nothing else, both
// request handlers ask so they serve the same set of files
const isDownloadable = function(filePath) {
    return path.extname(filePath).toLowerCase() === ".zip";
};

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
    httpDomain = "localhost";

    constructor() {

    };

    // the tag that stands for this exact content, the size alone cannot: an edit
    // keeping the byte count would keep its tag and be answered 304 forever
    fileETag(src, stats) {
        return "\"" + path.basename(src) + String(stats.size) + "-" + String(Math.floor(stats.mtimeMs)) + "\"";
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
                "etag": this.fileETag(src, stats),
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
                "etag": this.fileETag(src, stats),
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

    // the SPA fallback is for routes only: a missing asset stays a 404, or a
    // mistyped import() specifier would arrive as index.html and fail on its MIME
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

    // what a 304 carries instead: the same freshness, no Content-Length for a
    // body that is not coming, which would leave the client waiting on the socket
    notModifiedHeaders(fileData) {
        return {
            "Cache-Control": "no-cache",
            "Last-Modified": fileData["lastModified"],
            "ETag": fileData["etag"]
        };
    };

    

    // every file this server can hand out, as it is on disk right now
    async scanFiles() {
        const found = new Map();
        // download path first, so the web files win on a name collision
        for (const basePath of [this.httpDownloadPath, this.httpBasePath]) {
            let names;
            try {
                names = await fs.readdir(basePath, {"recursive": true});
            } catch (error) {
                continue;   // nothing has been built into this folder
            }
            for (const name of names) {
                if (basePath === this.httpDownloadPath && isDownloadable(name) === false) {
                    continue;
                }
                const src = path.join(basePath, name);
                let stats;
                try {
                    stats = await fs.stat(src);
                } catch (error) {
                    continue;   // gone between the listing and the stat
                }
                if (stats.isFile() === false) {
                    continue;   // skip directories
                }
                found.set(name.split(path.sep).join("/"), {"path": src, "stats": stats});
            }
        }
        return found;
    };

    // what the index holds about one file, without its bytes
    cacheEntry(src, stats) {
        return {
            "path": src,
            "lastModified": new Date(stats.mtimeMs).toUTCString(),
            "type": getMIMEType(path.extname(src)) || "text/plain",
            "size": stats.size,
            "mtimeMs": stats.mtimeMs,
            "etag": this.fileETag(src, stats),
            "accesses": new Array(this.httpCacheUpdateLength * 2).fill(0),
            "accessed": 0
        };
    };

    // the index, rebuilt from a fresh listing so a file created or deleted since
    // the boot is seen; the access history survives, it belongs to the file
    async buildCache() {
        const found = await this.scanFiles();
        const cache = new Map();
        for (const [key, file] of found) {
            const entry = this.cacheEntry(file["path"], file["stats"]);
            const previous = this.httpCache.get(key);
            if (typeof previous !== "undefined") {
                entry["accesses"] = previous["accesses"];
                entry["accessed"] = previous["accessed"];
                const isSame = previous["size"] === entry["size"] && previous["mtimeMs"] === entry["mtimeMs"];
                if (isSame === true && typeof previous["buffer"] !== "undefined") {
                    entry["buffer"] = previous["buffer"];
                }
            }
            cache.set(key, entry);
        }
        this.httpCache = cache;
    };

    async refreshCache() {
        await this.buildCache();

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

        // walk in priority order and admit what fits, a file too large for what
        // is left is passed over so a smaller one behind it still gets in
        const admitted = new Set();
        let currentSize = 0;
        for (const el of priorityOrder) {
            if (el["priority"] >= 0) {
                break;      // never asked for, nothing to hold in memory for
            }
            const size = this.httpCache.get(el["file"])["size"];
            if (currentSize + size > this.httpCacheSize) {
                continue;
            }
            currentSize += size;
            admitted.add(el["file"]);
        }

        // let go of everything the budget no longer covers
        for (const [key, fileData] of this.httpCache) {
            if (admitted.has(key) === false) {
                delete fileData["buffer"];
            }
        }

        // and read in what it does
        for (const key of admitted) {
            const fileData = this.httpCache.get(key);
            if (typeof fileData["buffer"] !== "undefined") {
                continue;
            }
            const file = await this.getFileData(fileData["path"]);
            if (typeof file === "undefined") {
                continue;
            }
            fileData["buffer"] = file["buffer"];
            fileData["size"] = file["size"];
            fileData["lastModified"] = file["lastModified"];
            fileData["etag"] = file["etag"];
        }
    };

    httpsRequestHandler = async (req, res) => {
        const basePaths = [this.httpBasePath, this.httpDownloadPath];
        const filePath = this.requestPath(req.url);

        // get requested file
        let fileData;
        for (const basePath of basePaths) {
            if (basePath === this.httpDownloadPath && isDownloadable(filePath) === false) {
                continue; // the download folder hands out the client zips only
            }
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
            res.writeHead(304, this.notModifiedHeaders(fileData));
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
            res.writeHead(304, this.notModifiedHeaders(fileData));
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
            res.writeHead(200, this.fileHeaders(file));
            file["stream"].pipe(res);
        } else {
            res.writeHead(200, this.fileHeaders(fileData));
            res.write(fileData["buffer"]);
            res.end();
        }
    };

    httpRedirectHandler = (req, res) => {
        // an HTTP/1.0 request carries no Host, and the header is attacker text
        // besides: the configured domain stands in for anything malformed
        const host = typeof req.headers.host === "string" ? req.headers.host : "";
        const name = host.split(":")[0];
        const myURL = HOST_NAME.test(name) === true ? name : this.httpDomain;
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

        // index.json is part of a build, never rewritten here: a client is only
        // ever handed the configuration of the build it is part of

        // create HTTP server request handler
        let requestHandle = null;
        if (typeof conf["http"]["cache"] !== "object") {
            requestHandle = this.httpsRequestHandler;
        } else {
            // build cache
            this.httpCacheSize = conf["http"]["cache"]["size"];
            this.httpCacheSizeLimit = conf["http"]["cache"]["fileSizeLimit"];
            await this.buildCache();

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
        this.httpDomain = conf["http"]["domain"];
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
