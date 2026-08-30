"use strict";

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import process from "node:process";

// first-party dependencies
import { argGet, getVersion } from "./common.js";
import { loadConfig } from "./config.js";
import { compileClients } from "./building.js";

//
// Main
//
const main = async function(args) {
    // Help
    const helpFlag = argGet(args, "--help", false) || argGet(args, "-h", false);
    if (helpFlag) {
        console.log("Usage: npm run server [-- --configuration=<path>] [-- --compile] [-- --exit] [-- --help] [-- --version]\n\n  -c, --configuration <path>  path to the JSON configuration file (default: ./conf/conf.json)\n  --compile                    force (re)compile the Electron client bundles from ./bin into ./tmp\n  --exit                       validate the configuration/compile and exit without starting listeners\n  -h, --help                   show this help message\n  -v, --version                show the project version");
        return;
    }

    // Verison
    const versionFlag = argGet(args, "--version", false) || argGet(args, "-v", false);
    if (versionFlag) {
        console.log(await getVersion());
        return;
    }

    // Read CLI options
    process.stdout.write("Reading arguments...    ");
    const confPath = path.resolve(argGet(args, "--configuration", true, true) || argGet(args, "-c", true, false) || "./conf/config.json");
    const compileFlag = argGet(args, "--compile", false) || false;
    const exitFlag = argGet(args, "--exit", false) || false;
    process.stdout.write("done\n");

    // Load and check the configuration
    process.stdout.write("Load the configuration...    ");
    let conf = null;
    try {
        conf = await loadConfig(confPath);
    } catch (error) {
        process.stdout.write("failed\n");
        console.error(error.message);
        process.exitCode = 1;
        return;
    }
    conf["flags"] = {};
    conf["flags"]["compile"] = compileFlag;
    conf["flags"]["exit"] = exitFlag;
    process.stdout.write("done\n");

    // Build the web client and the desktop distributables
    process.stdout.write("Compiling clients...    ");
    let isCompiled = false;
    try {
        isCompiled = await compileClients(conf);
    } catch (error) {
        process.stdout.write("failed\n");
        console.error(error.message);
        process.exitCode = 1;
        return;
    }
    if (isCompiled === true) {
        process.stdout.write("done\n");
    } else {
        process.stdout.write("skipped\n");
    }

    // TODO: start the HTTP/WS servers
};
main(process.argv);
