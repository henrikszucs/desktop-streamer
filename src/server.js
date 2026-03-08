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
import Mime from "easy-mime";
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

// class that help to process configuration and compile clients
const Configure = class {
    constructor() {

    };
    async parseConfUser(confStr="") {

    };
    async compile(confSystem, confUser) {

    };
};

// websocket and http server
const Server = class {
    constructor() {

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
    const confUser = await configure.parseConfUser(await fs.readFile(confPath, "utf8"));
    process.stdout.write("done\n");

    // Compile the clients
    process.stdout.write("Compiling clients...    ");
    const isDone = await configure.compile(confSystem, confUser);
    if (isDone) {
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