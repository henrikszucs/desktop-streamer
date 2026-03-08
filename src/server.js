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



// class that help to process configuration and compile clients
const Configure = class {

    constructor() {
        const schema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": "Desktop Streamer Server Configuration",
            "type": "object",
            "anyOf": [
                {"required": ["http"]},
                {"required": ["ws"]}
            ],
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
        const isCompiled = await this.isDirEmpty(this.compilesPath, this.compilesSkipPaths);
        
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
            console.error("No supported electron dist found in: " + sourcePath);
            return false;
        }

        // generate conf script ()
        const confClient = {};
        if (confUser["http"]) {
            confClient["http"] = {
                "domain": confUser["http"]["domain"],
                "port": confUser["http"]["port"],
                "clients": []
            };
            if (confUser["http"]["remote"]) {
                confClient["ws"] = {
                    "host": confUser["http"]["remote"]["host"],
                    "port": confUser["http"]["remote"]["port"]
                };
            }
        }
        if (confUser["ws"]) {
            confClient["ws"] = {
                "domain": confUser["ws"]["domain"],
                "port": confUser["ws"]["port"]
            };
        }
        for (const job of jobs) {
            const name = job.os + "-" + job.arch + (job.isZip ? ".zip" : "");
            confClient["http"]["clients"].push(name);
        }
        let confString = "\"use strict\";\nexport default" + JSON.stringify(confClient) + ";";
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
    
        await deleteContents(resolvedTarget, resolvedTarget, skipPaths);
    
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
                await deleteContents(rootPath, entryPath, skipPaths);
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