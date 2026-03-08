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



// generate random ID
const generateId = function(length=10, chars="1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
    let id = "";
    for (let i = 0; i < length; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
};

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

const serverScriptPath = import.meta.dirname;
const ajv = new Ajv();

// class that help to process configuration and compile clients
const Configure = class {

    constructor() {
        const schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": "Desktop Streamer Server Configuration",
            "type": "object",
            "required": ["http", "ws"],
            "additionalProperties": false,
            "properties": {
                "http": {
                    "type": "object",
                    "required": ["domain", "port", "key", "cert"],
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
                        "key": {
                            "type": "string",
                            "minLength": 1
                        },
                        "cert": {
                            "type": "string",
                            "minLength": 1
                        },
                        "redirect": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 65535
                        },
                        "remote": {
                            "type": "object",
                            "required": ["host", "port"],
                            "additionalProperties": false,
                            "properties": {
                                "host": {
                                    "type": "string",
                                    "minLength": 1
                                },
                                "port": {
                                    "type": "integer",
                                    "minimum": 1,
                                    "maximum": 65535
                                }
                            }
                        }
                    }
                },
                "ws": {
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
                        "key": {
                            "type": "string",
                            "minLength": 1
                        },
                        "cert": {
                            "type": "string",
                            "minLength": 1
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
                }
            }
        };

        this.validate = ajv.compile(schema);
        this.sourcePath = path.join("./bin");
        this.compilePath = path.join("./bin");

    };
    async parseConfUser(confPath="") {
        const confStr = await fs.readFile(confPath, "utf8");
        const confUser = JSON.parse(confStr);
        const valid = this.validate(confUser);
        if (!valid) {
            throw new Error("Invalid configuration: " + ajv.errorsText(this.validate.errors));
        }

        // set key and cert paths
        confUser["http"]["key"] = setAbsolute(confUser.http.key, path.dirname(confPath));
        confUser["http"]["cert"] = setAbsolute(confUser.http.cert, path.dirname(confPath));
        confUser["ws"]["key"] = setAbsolute(confUser.ws.key, path.dirname(confPath));
        confUser["ws"]["cert"] = setAbsolute(confUser.ws.cert, path.dirname(confPath));

        // load key and cert to memory
        confUser["http"]["keyData"] = await fs.readFile(confUser.http.key, {"encoding": "utf8"});
        confUser["http"]["certData"] = await fs.readFile(confUser.http.cert, {"encoding": "utf8"});
        confUser["ws"]["keyData"] = await fs.readFile(confUser.ws.key, {"encoding": "utf8"});
        confUser["ws"]["certData"] = await fs.readFile(confUser.ws.cert, {"encoding": "utf8"});

        return confUser;
    };
    async compile(confSystem, confUser) {

    };


    async deletePath(targetPath, keepDir, keepPaths = []) {
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
    
        await deleteContents(resolvedTarget, resolvedTarget, keepPaths);
    
        if (!keepDir) {
            const remaining = await fs.readdir(resolvedTarget);
            if (remaining.length === 0) {
                await fs.rmdir(resolvedTarget);
            }
        }
    };
    async deleteContents(rootPath, currentPath, keepPaths) {
        const entries = await fs.readdir(currentPath);
    
        for (const entry of entries) {
            const entryPath = path.join(currentPath, entry);
            const relativePath = path.relative(rootPath, entryPath).split(path.sep).join("/");
    
            // Exact match — skip entirely
            if (keepPaths.includes(relativePath)) {
                continue;
            }
    
            // Check if this entry is a parent of any keepPath
            const isParentOfKept = keepPaths.some(
                (kp) => kp.startsWith(relativePath + "/")
            );
    
            if (isParentOfKept) {
                // Recurse into it but don't delete it
                await deleteContents(rootPath, entryPath, keepPaths);
            } else {
                await fs.rm(entryPath, { recursive: true });
            }
        }
    };
};

// websocket and http server
const Server = class {
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

    async start(confUser) {
        
    };
    async stop() {

    };
};







const main = async function(args) {
    const configure = new Configure();
    const server = new Server();

    // Read CLI options
    process.stdout.write("Reading arguments...    ");
    const confPath = path.resolve(getArg(process.argv, "--configuration", true, true) || getArg(process.argv, "-c", true, false) || "./conf/conf.json");
    const complieFlag = getArg(process.argv, "--compile", false) || false;
    const exitFlag = getArg(process.argv, "--exit", false) || false;
    process.stdout.write("done\n");
    
    // Process the configuration and parameters
    process.stdout.write("Load the configuration...    ");
    const confSystem = {};
    confSystem["isCompile"] = complieFlag;
    confSystem["isExit"] = exitFlag;
    const confUser = await configure.parseConfUser(confPath);
    process.stdout.write("done\n");

    console.log(confUser);
    // Compile the clients
    /*
    process.stdout.write("Compiling clients...    ");
    const isDone = await configure.compile(confSystem, confUser);
    if (isDone) {
        process.stdout.write("done\n");
    } else {
        process.stdout.write("skipped\n");
    }

    // Start HTTP/WS server
    await server.start(confUser);*/

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