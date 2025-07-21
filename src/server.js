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
import { type } from "node:os";

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

// this will join path if relative
const setAbsolute = function(src, origin) {
    if (path.isAbsolute(src) === false) {
        src = path.join(origin, src);
    }
    return path.resolve(src);
};

// proceed the conf file fields
const processConf = async function(confPath) {
    confPath = setAbsolute(confPath, process.cwd());
    //console.log(confPath);

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
    if (typeof confIn["http"] === "object") {
        confOut["http"] = {};

        // check domain
        if (typeof confIn["http"]["domain"] !== "string" || confIn["http"]["domain"].length === 0) {
            throw new Error("Invalid HTTP domain: " + confIn["http"]["domain"]);
        }

        // check port
        if (typeof confIn["http"]["port"] !== "number" || confIn["http"]["port"] < 1 || confIn["http"]["port"] > 65535) {
            throw new Error("Invalid HTTP port: " + confIn["http"]["port"]);
        }
        confOut["http"]["port"] = confIn["http"]["port"];

        // check key
        if (typeof confIn["http"]["key"] !== "string") {
            throw new Error("Invalid HTTP key path: " + confIn["http"]["key"]);
        }
        try {
            const keyPath = setAbsolute(confIn["http"]["key"], path.dirname(confPath));
            confOut["http"]["key"] = await fs.readFile(keyPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid HTTP key path: " + confIn["http"]["key"] + " - " + error.message);
        }

        // check cert
        if (typeof confIn["http"]["cert"] !== "string") {
            throw new Error("Invalid HTTP cert path: " + confIn["http"]["cert"]);
        }
        try {
            const certPath = setAbsolute(confIn["http"]["cert"], path.dirname(confPath));
            confOut["http"]["cert"] = await fs.readFile(certPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid HTTP cert path: " + confIn["http"]["cert"] + " - " + error.message);
        }

        // check redirect (optional)
        if (typeof confIn["http"]["redirect"] === "number") {
            if (confIn["http"]["redirect"] < 1 || confIn["http"]["redirect"] > 65535 || confIn["http"]["redirect"] === confIn["http"]["port"]) {
                throw new Error("Invalid HTTP redirect port: " + confIn["http"]["redirect"]);
            }
            confOut["http"]["redirect"] = confIn["http"]["redirect"];
        }

        // check cache (optional)
        if (typeof confIn["http"]["cache"] === "object") {
            confOut["http"]["cache"] = {};
            // check size
            if (typeof confIn["http"]["cache"]["size"] !== "number" || confIn["http"]["cache"]["size"] < 0) {
                throw new Error("Invalid HTTP cache size: " + confIn["http"]["cache"]["size"]);
            }
            confOut["http"]["cache"]["size"] = confIn["http"]["cache"]["size"];
            // check expire
            if (typeof confIn["http"]["cache"]["expire"] !== "number" || confIn["http"]["cache"]["expire"] < 0) {
                throw new Error("Invalid HTTP cache expire: " + confIn["http"]["cache"]["expire"]);
            }
            confOut["http"]["cache"]["expire"] = confIn["http"]["cache"]["expire"];
        }

        // check remote (optional)
        if (typeof confIn["http"]["remote"] === "object") {
            confOut["http"]["remote"] = {};
            // check host
            if (typeof confIn["http"]["remote"]["host"] !== "string" || confIn["http"]["remote"]["host"].length === 0) {
                throw new Error("Invalid HTTP remote host: " + confIn["http"]["remote"]["host"]);
            }
            confOut["http"]["remote"]["host"] = confIn["http"]["remote"]["host"];
            // check port
            if (typeof confIn["http"]["remote"]["port"] !== "number" || confIn["http"]["remote"]["port"] < 1 || confIn["http"]["remote"]["port"] > 65535) {
                throw new Error("Invalid HTTP remote port: " + confIn["http"]["remote"]["port"]);
            }
            confOut["http"]["remote"]["port"] = confIn["http"]["remote"]["port"];
        }
    }


    // check WS settings
    if (typeof confIn["ws"] === "object") {
        confOut["ws"] = {};

        // check port
        if (typeof confIn["ws"]["port"] !== "number" || confIn["ws"]["port"] < 1 || confIn["ws"]["port"] > 65535) {
            throw new Error("Invalid WS port: " + confIn["ws"]["port"]);
        }
        confOut["ws"]["port"] = confIn["ws"]["port"];

        // check key
        if (typeof confIn["ws"]["key"] !== "string") {
            throw new Error("Invalid WS key path: " + confIn["ws"]["key"]);
        }
        try {
            const keyPath = setAbsolute(confIn["ws"]["key"], path.dirname(confPath));
            confOut["ws"]["key"] = await fs.readFile(keyPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid WS key path: " + confIn["ws"]["key"] + " - " + error.message);
        }

        // check cert
        if (typeof confIn["ws"]["cert"] !== "string") {
            throw new Error("Invalid WS cert path: " + confIn["ws"]["cert"]);
        }
        try {
            const certPath = setAbsolute(confIn["ws"]["cert"], path.dirname(confPath));
            confOut["ws"]["cert"] = await fs.readFile(certPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid WS cert path: " + confIn["ws"]["cert"] + " - " + error.message);
        }

        // check SQL
        if (typeof confIn["ws"]["sql"] !== "object") {
            throw new Error("Invalid WS SQL configuration: " + confIn["ws"]["sql"]);
        }
        confOut["ws"]["sql"] = {};

        // check SQL host
        if (typeof confIn["ws"]["sql"]["host"] !== "string" || confIn["ws"]["sql"]["host"].length === 0) {
            throw new Error("Invalid WS SQL host: " + confIn["ws"]["sql"]["host"]);
        }
        confOut["ws"]["sql"]["host"] = confIn["ws"]["sql"]["host"];

        // check SQL port
        if (typeof confIn["ws"]["sql"]["port"] !== "number" || confIn["ws"]["sql"]["port"] < 1 || confIn["ws"]["sql"]["port"] > 65535) {
            throw new Error("Invalid WS SQL port: " + confIn["ws"]["sql"]["port"]);
        }
        confOut["ws"]["sql"]["port"] = confIn["ws"]["sql"]["port"];

        // check SQL user
        if (typeof confIn["ws"]["sql"]["user"] !== "string") {
            throw new Error("Invalid WS SQL user: " + confIn["ws"]["sql"]["user"]);
        }
        confOut["ws"]["sql"]["user"] = confIn["ws"]["sql"]["user"];

        // check SQL password
        if (typeof confIn["ws"]["sql"]["pass"] !== "string") {
            throw new Error("Invalid WS SQL password: " + confIn["ws"]["sql"]["pass"]);
        }
        confOut["ws"]["sql"]["pass"] = confIn["ws"]["sql"]["pass"];
    }


    // check HTTP and WS constraints
    if (typeof confOut["http"] !== "object" && typeof confOut["ws"] !== "object") {
        throw new Error("At least one of HTTP or WS configuration must be provided!");
    }
    if (typeof confOut["http"] === "object" && typeof confOut["http"]["remote"] !== "object" && typeof confOut["ws"] !== "object") {
        throw new Error("HTTP remote configuration must be provided if no local WS server in configuration!");
    }
    if (typeof confOut["ws"] === "object" && typeof confOut["http"]["remote"] === "object") {
        throw new Error("WS server cannot be created if HTTP remote is configured!");
    }

    return confOut;
};

// create HTTP backend
const createHttpServer = function(conf) {

};

// create WebSocket backend
const createWebSocketServer = function(conf) {

};


// main function
const main = async function(args) {
    // Read CLI options
    process.stdout.write("Reading arguments...    ");
    const confPath = getArg(process.argv, "--configuration", true, true) || getArg(process.argv, "-c", true, false) || "./conf/conf.json";
    const complieFlag = getArg(process.argv, "--compile", false) || false;
    const exitFlag = getArg(process.argv, "--exit", false) || false;
    process.stdout.write("done\n");

    
    // Process the configuration
    process.stdout.write("Load the configuration...    ");
    const conf = await processConf(confPath);
    process.stdout.write("done\n");


    // Compile the clients
    process.stdout.write("Compiling clients...    ");
    const compilePath = "./tmp";
    let isCompiled = false;
    try {
        await fs.access(compilePath, fs.constants.R_OK | fs.constants.W_OK);
        const dirIter = await fs.opendir(compilePath);
        const {value, done} = await dirIter[Symbol.asyncIterator]().next();
        if (!done) {
            await dirIter.close();
            isCompiled = true;
        }
    } catch (error) {}
    if (complieFlag || isCompiled === false) {
        //remove old compiled files
        for (const file of await fs.readdir(compilePath)) {
            await fs.rm(path.join(compilePath, file), { recursive: true, force: true });
        }
        const zip = new JSZip();
        process.stdout.write("done\n");
    } else {
        process.stdout.write("skip\n");
    }



    // Start HTTP server
    


    // Start WebSocket server


    // Cleanup
    
};
main(process.argv);