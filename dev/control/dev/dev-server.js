"use strict";
import process from "node:process";
import path from "node:path";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";

import { MIME } from "./mime.js";

const thisDirPath = import.meta.dirname;

const conf = {
    "port": 443,
    "redirectFrom": 80,
    "key": await fs.readFile(path.join(thisDirPath, "server.key")),
    "cert": await fs.readFile(path.join(thisDirPath, "server.crt"))
};

// Static HTTP file server
const getFileData = async function(src) {
    try {
        const data = await fs.readFile(src);
        const stats = await fs.stat(src);
        const date = new Date(stats.mtimeMs);
        return {
            "lastModified": date.toUTCString(),
            "type": MIME.getMIMEType(path.extname(src)),
            "size": stats.size,
            "buffer": data
        };
    } catch (error) {
        return undefined;
    }
    
};
const getFileDataStream = async function(src) {
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
            "type": MIME.getMIMEType(path.extname(src)),
            "size": stats.size,
            "stream": stream
        };
    } catch (error) {
        return undefined;
    }
};
const generateCache = async function(src, ignore=[]) {
    const cache = new Map();
    
    //goes through along all element
    const entries = await fs.readdir(src, { "recursive": true });
    
    //get files data and type
    for (const enrty of entries) {
        const fullPath = path.join(src, enrty);
        const enrtyStat = await fs.stat(fullPath);
        const isChild = ignore.some(function (el) {
            return path.relative(el, fullPath).startsWith("..") === false || path.relative(el, fullPath) === "";
        });
        if (enrtyStat.isFile() && isChild === false) {
            const data = await getFileData(fullPath);
            cache.set(enrty.replaceAll("\\", "/"), data);
        }
    }
    return cache;
};
const getFile = async function(basePaths, filePath, cache) {
    let fileData;
    for (const basePath of basePaths) {
        fileData = cache.get(filePath); // cache get
        if (fileData === undefined) {
            fileData = await getFileDataStream(path.join(basePath, filePath)); // fresh get
        }
        if (fileData !== undefined) {
            return fileData;
        }
    }
    return fileData;
};
const HTTPServerStart = async function(conf) {
    const basePaths = [
        path.join(thisDirPath, "..")
    ];
    
    //cache
    const fileCache = new Map();

    // file listening function
    const requestHandle = async function(req, res) {
        const filePath = req.url.slice(1);

        let fileData = await getFile(basePaths, filePath, fileCache); // get requested
        if (typeof fileData === "undefined") {
            fileData = await getFile(basePaths, "index.html", fileCache); // get default
        }

        if (typeof fileData === "undefined") {
            res.writeHead(404);
            res.end("404 Not Found");
            return;
        }

        res.writeHead(200, {
            //"Content-Security-Policy": "default-src 'self'",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Last-Modified": fileData["lastModified"],
            "Content-Length": fileData["size"],
            "Content-Type": fileData["type"]
        });

        if (typeof fileData["buffer"] !== "undefined") {
            //cached version
            res.write(fileData["buffer"]);
            res.end(); 
        } else {
            //stream version
            fileData["stream"].pipe(res);
        }
    };

    // redirect function
    const redirectHandle = function(req, res) {
        const myURL = req.headers.host.split(":")[0];
        const myPort = conf["port"] !== 443 ? ":" + conf["port"] : "";
        res.writeHead(302, {
            "Location": "https://" + myURL + myPort + req.url
        });
        res.end("");
    };

    //open servers
    let servers = [];
    const server = https.createServer({
        "key": conf["key"],
        "cert": conf["cert"]
    }, requestHandle);
    console.log ("    Open server at https://localhost:" + conf["port"]);
    server.listen(conf["port"]);
    servers.push(server);
    if (typeof conf["redirectFrom"] !== "undefined") {
        const server = http.createServer(redirectHandle);
        console.log ("    Open redirect at http://localhost:" + conf["redirectFrom"]);
        server.listen(conf["redirectFrom"]);
        servers.push(server);
    }
    return servers;
};
const HTTPServerStop = async function(servers) {
    for (const server of servers) {
        await new Promise(function(resolve) {
            const timeOut = setTimeout(function() {
                resolve(false);
            }, 5000);
            server.close(function() {
                clearTimeout(timeOut);
                resolve(true);
            });
        });
    }
};

// Close the application
let isClosing = false;
const close = async function(HTTPservers) {
    if (isClosing) {
        return;
    }
    isClosing = true;

    process.stdout.write("Closing servers...    ");
    await HTTPServerStop(HTTPservers);
    process.stdout.write("done\n");

    isClosing = false;
};


// Main start
const main = async function(args) {
    // Start HTTP server
    process.stdout.write("Start HTTP servers...    \n");
    const HTTPservers = await HTTPServerStart(conf);
    process.stdout.write("done\n");

    // Cleanup
    process.stdout.write("Press CTRL+C to stop servers\n");
    process.on("SIGTERM", async function() {
        process.stdout.write("SIGTERM signal received\n");
        await close(HTTPservers);
        process.exit(0); 
    });
    process.on("SIGINT", async function() {
        process.stdout.write("SIGINT signal received\n");
        await close(HTTPservers);
        process.exit(0); 
    });
};
main();