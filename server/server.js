"use strict";
//import
const path = require("node:path");
const process = require("node:process");
const fs = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");

const mime = require("./libs/mime.js");

const JSZip = require("jszip");
const ws = require("ws");



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

    process.stdout.write("\n    Building cache...    ");
    //Generate desktop client zips
    //await generateClient(basePath, electronPath, tmpPath);
    //Cache UI pages
    let fileCache = new Map();
    //fileCache = await generateCache(basePath, [tmpPath]);
    process.stdout.write("done\n");


    // file listening function
    const requestHandle = async function(req, res) {
        const filePath = req.url.slice(1);

        let fileData = await getFile(basePath, filePath, fileCache); // get requested
        if (typeof fileData === "undefined") {
            fileData = await getFile(basePath, "index.html", fileCache); // get default
        }

        res.writeHead(200, {
            //"Content-Security-Policy": "default-src 'self'",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Last-Modified": fileData["lastModified"],
            "Content-Length": fileData["size"],
            "Content-Type": fileData["type"]
        });

        if (typeof fileData["stream"] !== "undefined") {
            fileData["stream"].pipe(res);
        } else {
            res.write(fileData["buffer"]);
            res.end(); //end the response
        }
    };

    // redirect function
    const redirectHandle = function(req, res) {
        const myURL = req.headers.host.split(":")[0];
        const myPort = conf["port"] !== 443 ? ":" + conf["port"] : "";
        res.writeHead(302, {
            "Location": "https://" + myURL + myPort + req.url
        });
        res.end();
    };

    //create HTTP or HTTPS server
    if (typeof conf["https"] !== "undefined") {
        const options = {
            "key": conf["https"]["key"],
            "cert": conf["https"]["cert"]
        };
        const server = https.createServer(options, requestHandle).listen(conf["port"]);
        servers.push(server);

        if (typeof conf["https"]["redirectFrom"] === "number") {
            const serverRedirect = http.createServer(options, redirectHandle).listen(conf["https"]["redirectFrom"]);
            servers.push(serverRedirect);
        }
        
    } else {
        const server = http.createServer(requestHandle).listen(conf["port"]);
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


// Runtime (in memory storage for websocket and for business logic)
const Runtime = class {
    clients = new Map();
    constructor() {
        
    };


    // helper for communication
    Communicator = class extends EventTarget {
        senderFn = function(data) {ws.send(JSON.stringify(data));};
        recieverFn = function(get) {ws.addEventListener("message", function(event) {get(JSON.parse(event.data));})};
        processes = [];
        isRed = false;
        gcClear = 0;
        gcClearLimit = 10;

        FROM_MYSELF = 0;
        FROM_OTHER = 1;
        
        // methods: invoke, send, reply (only in event),
        // events: invoke, send
        constructor(isRed, callback) {
            super();

            this.reset(isRed, callback);
        }
        reset(isRed=false, callback) {
            this.FROM_MYSELF = (isRed ? 1 : 0);
            this.FROM_OTHER = (isRed ? 0 : 1);

            this.processes = [];
            this.senderFn = callback["senderFn"];
            this.recieverFn = callback["recieverFn"];

            this.recieverFn(function(data) {
                //handle error
                if ((data instanceof Array) === false || data.length < 2) {
                    console.log("Wrong format");
                    this.senderFn([this.FROM_OTHER, -1, 400]);
                } else {
                    this.recieve(data);
                }
            }.bind(this));
            
        };
        
        send(msg={}) {
            //send data, fire and forget
            let data = [this.FROM_MYSELF, -1, msg];
            this.senderFn(data);
        };

        gc() {
            const lastEl = this.processes.length - 1;
            let i = lastEl;
            while(i >= 0 && this.processes[i] === null) {
                i--;
            }
            this.processes.splice(i+1, lastEl-i);
        };
        async invoke(msg={}, timeout=5000) {
            return new Promise((resolve, reject) => {
                // run garbage collector
                if (this.gcClear > this.gcClearLimit) {
                    this.gcClear = 0;
                    this.gc();
                }
                this.gcClear++;

                //get unique id from stack
                const id = this.processes.length;

                //start timeout
                const myTimeout = setTimeout(function() {
                    reject(new Error("Timeout (" + id + ")"));
                }, timeout);

                //set callback function in stack
                this.processes.push((data) => {
                    this.processes[id] = null;
                    clearTimeout(myTimeout);
                    resolve(data);
                });
                
                //send data
                let data = [this.FROM_MYSELF, id, msg];
                this.senderFn(data);
            });
        };
        recieve(data) {
            //process data
            if (data[0] === this.FROM_MYSELF) {
                //recieve response
                if (data[1] < this.processes.length && this.processes[data[1]] !== null) {
                    this.processes[data[1]](data[2]);
                }

            } else if (data[0] === this.FROM_OTHER) {
                //recieve request
                if (data[1] === -1) {
                    // no need reply for this
                    this.dispatchEvent(
                        new CustomEvent("send", {"detail": {
                            "data": data[2]
                        }})
                    );
                } else {
                    // need reply for this with id
                    this.dispatchEvent(
                        new CustomEvent("invoke", {"detail": {
                            "reply": this.reply.bind(this),
                            "id": data[1],
                            "data": data[2]
                        }})
                    );
                }
                
            }
        };
        reply(id, msg={}) {
            //send data
            let data = [this.FROM_OTHER, id, msg];
            this.senderFn(data);
        };
    };


    //
    // clients functions
    //
    // client connect and handle API
    async clientCreate(ws) {
        let clientId;
        do {
            clientId = (Math.floor(Math.random() * 9999) + 1).toString();
        } while (this.clients.has(clientId));
        console.log("Client connected (" + clientId + ")");

        const communicator = new this.Communicator(true, {
            "senderFn": function(data) {
                ws.send(JSON.stringify(data))
            },
            "recieverFn": function(get) {
                ws.addEventListener("message", function(event) {
                    let data = [];
                    try {
                        data = JSON.parse(event.data)
                    } catch (error) {
                        
                    }
                    get(data);
                });
            }
        });
        this.clients.set(clientId, communicator);

        // listen error
        ws.addListener("error", (err) => {
            console.log("Error " + err);
        });

        // listen close
        ws.addEventListener("close", () => {
            console.log("Client disconnected (" + clientId + ")");
            this.clients.delete(clientId);
        });

        //listen non-respond api
        communicator.addEventListener("send", (event) => {
            //forward ice change
            if (event.detail.data["method"] === "iceSend") {
                const client = this.clients.get(event.detail.data["id"]);
                if (typeof client === "undefined") {
                    return;  
                }
                const data = event.detail.data;
                data["fromId"] = clientId;
                client.send(data);
                return;
            }
        });

        //listen respond api
        communicator.addEventListener("invoke", async (event) => {
            //get own id
            if (event.detail.data["method"] === "myId") {
                event.detail.reply(event.detail.id, clientId);
                return;
            }
            //call other with webrtc datachannel
            if (event.detail.data["method"] === "call") {
                const client = this.clients.get(event.detail.data["id"]);
                if (typeof client === "undefined" || event.detail.data["id"] === clientId) {
                    event.detail.reply(event.detail.id, {
                        "isSuccess": false
                    });
                    return;
                }
                try {
                    let res = await client.invoke({
                        "method": "call",
                        "fromId": clientId,
                        "offer": event.detail.data["offer"]
                    });
                    event.detail.reply(event.detail.id, res);
                } catch (error) {
                    event.detail.reply(event.detail.id, {
                        "isSuccess": false
                    });
                }
                return;
            }
        });
    };
};


// Websocket server
const wsServerStart = async function(HTTPserver, runtime) {
    const wsServer = new ws.WebSocketServer({
        "server": HTTPserver
    });
    wsServer.addListener("connection", function(ws) {
        if (isClosing) {
            ws.terminate();
        } else {
            runtime.clientCreate(ws);
        }
    });
    return wsServer;
};
const wsServerStop = async function(ws) {
    return new Promise(function(resolve) {
        let round = 0;
        const close = function() {
            if (round === 0) {
                // First sweep, soft close
                ws.clients.forEach(function (socket) {
                    socket.close();
                });
            } else if (round < 20) {
                // Check clients
                let isAllClosed = true;
                for (const socket of ws.clients) {
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
                ws.clients.forEach(function(socket) {
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
};


// Close the application
let isClosing = false;
const close = async function(HTTPservers, runtime, ws) {
    if (isClosing) {
        return;
    }
    isClosing = true;

    process.stdout.write("Closing Websocket server...    ");
    await wsServerStop(ws);
    process.stdout.write("done\n");

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
    process.stdout.write("Start HTTP servers...    ");
    const HTTPservers = await HTTPServerStart(conf);
    process.stdout.write("done\n");

    // Create runtime
    process.stdout.write("Create runtime...    ");
    const runtime = new Runtime();
    process.stdout.write("done\n");

    // Start WS server
    process.stdout.write("Start Websocket server...    ");
    const ws = await wsServerStart(HTTPservers[0], runtime);
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
        await close(HTTPservers, runtime, ws);
        process.exit(0); 
    });
};
main(process.argv);