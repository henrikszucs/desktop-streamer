"use strict";
//import
const path = require("node:path");
const process = require("node:process");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const url = require("node:url");
const http = require("node:http");
const https = require("node:https");

const mime = require("./libs/mime.js");

const JSZip = require("jszip");
const express = require("express");
const { ExpressPeerServer } = require("peer");



// General functions
/**
 * Get a named CLI argument
 * @param {Object<Array>} args - Array of arguments
 * @param {string} argName - Argument to search
 * @param {string} def - Default value if argument not found
 */
const getArg = function(args, argName, def = "") {
    for (const arg of args) {
        if (arg.startsWith(argName)) {
            return arg.slice(argName.length);
        }
    }
    return def;
};

const cutEdges = function (str) {
    return str.slice(1, str.length-1);
};

const sortedIndex = function(array, value, func=function(el){return el}) {
    let low = 0;
    let high = array.length;
    while (low < high) {
        const mid = low + high >>> 1;
        if (func(array[mid]) < value) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
};



// Global configuration parse
const initialSetup = async function(confPath) {
    let confIn = {};
    let confOut = {};

    //this will convert path if relative to configuration file
    const confPathToAbsolute = function(src) {
        if (path.isAbsolute(src) === false) {
            src = path.join(process.cwd(), path.dirname(confPath), src);
        }
        return path.resolve(src);
    };
    
    //load conf file (required)
    const contents = await fs.readFile(confPath, {
        "encoding": "utf8"
    });
    confIn = JSON.parse(contents);
    if (typeof confIn !== "object") {
        throw new Error("Invalid JSON format!");
    }
    
    //check port value (required)
    if (typeof confIn["port"] !== "number" || Number.isInteger(confIn["port"]) === false || confIn["port"] < 0) {
        throw new Error("Invalid port number!");
    }
    confOut["port"] = confIn["port"];
    
    //check key and cert (optional)
    if (typeof confIn["https"] === "object") {
        //check cert path
        if (typeof confIn["https"]["key"] !== "string" && typeof confIn["https"]["cert"] !== "string") {
            throw new Error("Invalid cert or key path!");
        }
        confIn["https"]["key"] = confPathToAbsolute(confIn["https"]["key"]);
        confIn["https"]["cert"] = confPathToAbsolute(confIn["https"]["cert"]);
        //read cert
        confIn["https"]["key"] = await fs.readFile(confIn["https"]["key"], {
            "encoding": "utf8"
        });
        confIn["https"]["cert"] = await fs.readFile(confIn["https"]["cert"], {
            "encoding": "utf8"
        });
        //copy cert data
        confOut["https"] = {};
        confOut["https"]["key"] = confIn["https"]["key"];
        confOut["https"]["cert"] = confIn["https"]["cert"];
        //check redirect (optional)
        if (typeof confIn["https"]["redirectFrom"] !== "undefined") {
            if (typeof confIn["https"]["redirectFrom"] !== "number" || Number.isInteger(confIn["https"]["redirectFrom"]) === false || confIn["https"]["redirectFrom"] < 0 || confIn["https"]["redirectFrom"] === confOut["port"]) {
                throw new Error("Invalid redirect port number!");
            }
            confOut["https"]["redirectFrom"] = confIn["https"]["redirectFrom"];
        }
    }
    
    return confOut;
    
    /*
    output configuration:
        {
            "port": 443,
            "https": {                 //optional
                "key": "FILEDATA",
		        "cert": "FILEDATA",
		        "redirectFrom": 80     //optional
            }
        }
    */
    
};



// Static HTTP file server
const sockets = new Map();
let nextSocketId = 0;
const getFileData = async function(src) {
    try {
        const data = await fs.readFile(src);
        const stats = await fs.stat(src);
        const date = new Date(stats.mtimeMs);
        return {
            "lastModified": date.toUTCString(),
            "type": mime.getMIMEType(path.extname(src)),
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
        stream.on("end", function() {
            data.close();
        });
        return {
            "lastModified": date.toUTCString(),
            "type": mime.getMIMEType(path.extname(src)),
            "size": stats.size,
            "stream": stream
        };
    } catch (error) {
        return undefined;
    }
};
const generateClient = async function(srcUI, srcElectron, dest) {
    //goes through along UI element
    const cacheUI = new Map();
    const entriesUI = await fs.readdir(srcUI, { "recursive": true });

    //get static files data
    for (const enrty of entriesUI) {
        const fullPath = path.join(srcUI, enrty);
        const enrtyStat = await fs.stat(fullPath);
        if (enrtyStat.isFile() && path.relative(dest, fullPath).startsWith("..")) {
            const data = await getFileData(fullPath);
            cacheUI.set(enrty.replaceAll("\\", "/"), data);
        }
    }
    //console.log(cacheUI);
    

    //goes through along Electron elements
    const enviroments = ["electron-win32-x64.zip"];
    const cacheConf = new Map();
    const entriesConf = await fs.readdir(srcElectron, { "recursive": true });

    //get static files data
    for (const enrty of entriesConf) {
        const fullPath = path.join(srcElectron, enrty);
        const enrtyStat = await fs.stat(fullPath);
        if (enrtyStat.isFile() && enviroments.includes(enrty) === false) {
            const data = await getFileData(fullPath);
            cacheConf.set(enrty.replaceAll("\\", "/"), data);
        }
    }
    //console.log(cacheConf);

    //loop over electron platforms
    await fs.mkdir(dest, { "recursive": true });
    for (const enrty of enviroments) {
        const fullPath = path.join(srcElectron, enrty);
        //load exist zip
        const fileBuffer = await fs.readFile(fullPath);
        const zip = new JSZip();
        await zip.loadAsync(fileBuffer);

        //modify
        const pathUI = "resources/app/ui/";
        const cacheUIIt = cacheUI[Symbol.iterator]();
        for (const [file, content] of cacheUIIt) {
            zip.file(pathUI+file, content["buffer"]);
        }

        const pathConf = "resources/app/";
        const cacheConfIt = cacheConf[Symbol.iterator]();
        for (const [file, content] of cacheConfIt) {
            zip.file(pathConf+file, content["buffer"]);
        }

        //save
        const contentBuffer = await zip.generateAsync({"type":"nodebuffer"});
        await fs.writeFile(path.join(dest, enrty), contentBuffer);
    }

};
const generateCache = async function(src, ignore) {
    const cache = new Map();
    
    //goes through along all element
    const entries = await fs.readdir(src, { "recursive": true });
    
    //get files data and type
    for (const enrty of entries) {
        const fullPath = path.join(src, enrty);
        const enrtyStat = await fs.stat(fullPath);
        const isChild = ignore.some(function (el) {
            return path.relative(el, fullPath).startsWith("..") === false;
        });
        if (enrtyStat.isFile() && isChild === false) {
            const data = await getFileData(fullPath);
            cache.set(enrty.replaceAll("\\", "/"), data);
        }
    }
    return cache;
};
const getFile = async function(basePath, filePath, cache) {
    let fileData = cache.get(filePath); // cache get
    if (typeof fileData === "undefined") {
        fileData = await getFileDataStream(path.join(basePath, filePath)); // fresh get
    }
    return fileData;
};
const HTTPServerStart = async function(conf) {
    let servers = [];
    const basePath = "../client/ui";
    const tmpPath = "../client/ui/tmp";
    const electronPath = "../client/electron";

    process.stdout.write("\n    Building cache initial setup...    ");
    //Generate desktop client zips
    await generateClient(basePath, electronPath, tmpPath);

    //Cache UI pages
    let fileCache = new Map();
    //fileCache = await generateCache(basePath, [tmpPath]);
    process.stdout.write("done\n");
    
    //peerjs
    const peerjsPath = "peerjs";
    const connectPeerjs = function(server, app) {
        const peerServer = ExpressPeerServer(server, {
            "debug": true,
            "path": "/",
            "generateClientId": function() {
                let result = "";
                const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                const charactersLength = characters.length;
                for (let i = 0; i < 6; i++) {
                    result += characters[Math.floor(Math.random() * charactersLength)];
                }
                return result;
            }
        });
        app.use("/" + peerjsPath, peerServer);
    };

    // file listening function
    const app = express();
    app.all("*", async function(req, res, next) {
        const filePath = req.path.slice(1);
        if (filePath.startsWith(peerjsPath)) {
            next();
            return;
        }

        let fileData = await getFile(basePath, filePath, fileCache); // get requested
        if (typeof fileData === "undefined") {
            fileData = await getFile(basePath, "index.html", fileCache); // get default
        }

        res.status(200);
        res.set({
            //"Content-Security-Policy": "default-src 'self'",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Last-Modified": fileData["lastModified"],
            "Content-Length": fileData["size"],
            "Content-Type": fileData["type"]
        });

        if (typeof fileData["stream"] !== "undefined") {
            fileData["stream"].pipe(res);
        } else {
            res.send(fileData["buffer"]);
            res.end(); //end the response
        }
    });

    // redirect function
    const appR = express();
    appR.all("*", function(req, res) {
        const myURL = req.hostname;
        const myPort = conf["port"] !== 443 ? ":" + conf["port"] : "";
        res.writeHead(302, {
            "Location": "https://" + myURL + myPort + req.path
        });
        res.end();
    });


    //create HTTP or HTTPS server
    if (typeof conf["https"] !== "undefined") {
        //normal server
        const options = {
            "key": conf["https"]["key"],
            "cert": conf["https"]["cert"]
        };

        let server = https.createServer(options, app);
        connectPeerjs(server, app);
        server = server.listen(conf["port"]);
        server.on("connection", function (socket) {
            // Add a newly connected socket
            const socketId = nextSocketId++;
            sockets.set(socketId, socket);
          
            // Remove the socket when it closes
            socket.on("close", function () {
                sockets.delete(socketId);
            });
        });
        servers.push(server);

        //redirect server
        if (typeof conf["https"]["redirectFrom"] === "number") {
            const serverRedirect = http.createServer(options, appR).listen(conf["https"]["redirectFrom"]);
            servers.push(serverRedirect);
        }
        
    } else {
        //normal server
        const server = http.createServer(requestHandle);
        connectPeerjs(server, app);
        servers.push(server.listen(conf["port"]));
    }
    return servers;
};
const HTTPServerStop = async function(servers) {
    const it = sockets[Symbol.iterator]();
    for (const [key, value] of it) {
        value.destroy();
    }
    for (const server of servers) {
        await new Promise(function(resolve) {
            server.close(function() {
                resolve(true);
            });
        });
    }
};



// Close the server
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


//Main funtion
const main = async function(args) {
    // Read CLI options
    process.stdout.write("Load arguments...    ");
    const confPath = getArg(args, "--configuration=", "conf/conf.json");
    process.stdout.write("done\n");
    
    // Load configuration
    process.stdout.write("Run initial setup...    ");
    const conf = await initialSetup(confPath);
    process.stdout.write("done\n");
    
    // Start HTTP server
    process.stdout.write("Start servers...    ");
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
main(process.argv);