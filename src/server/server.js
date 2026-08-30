"use strict";

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";

// first-party dependencies
import { argGet } from "./common.js";
import { loadConfig } from "./config.js";

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
        const packageJsonPath = path.resolve(import.meta.dirname, "../../package.json");
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
        console.log(packageJson.version);
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

    // TODO: compile the clients (compileClients) and start the HTTP/WS servers
};
main(process.argv);
