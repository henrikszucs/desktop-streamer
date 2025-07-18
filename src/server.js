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

// third-party dependencies
import JSZip from "jszip";
import { WebSocketServer } from "ws";

// first-party dependencies
import Mime from "easy-mime";
import Communicator from "easy-communicator";

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
                return arg;
            }
        }
    }
    return undefined;
};

// this will join path if relative
const setRelative = function(src, origin) {
    if (path.isAbsolute(src) === false) {
        src = path.join(origin, src);
    }
    return path.resolve(src);
};

// Proceed the conf file
const processConf = async function(confPath) {
    confPath = setRelative(confPath, process.cwd());
    console.log(confPath);

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


    // check WS settings


    return confOut;
};


// main function
const main = async function(args) {
    // Read CLI options
    process.stdout.write("Reading arguments...    ");
    const confPath = getArg(process.argv, "--configuration", true, true) || getArg(process.argv, "-c", true, false) || "./conf/conf.json";
    process.stdout.write("done\n");

    // Process the configuration
    process.stdout.write("Load the configuration...    ");
    const conf = processConf(confPath);
    process.stdout.write("done\n");


    // Start HTTP server


    // Start WebSocket server


    // Cleanup
    
};
main(process.argv);