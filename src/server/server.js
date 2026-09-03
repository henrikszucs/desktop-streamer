"use strict";

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import process from "node:process";

// first-party dependencies
import { getArg, checkArg, getVersion } from "./common.js";
import { loadConfig } from "./config.js";
import { compileClients } from "./building.js";
import serverHTTP from "./http.js";
import serverWS from "./ws.js";

//
// Main
//
const main = async function(args) {
    // Help
    const helpFlag = getArg(args, "--help", false) || getArg(args, "-h", false);
    if (helpFlag) {
        console.log("Usage: npm run server [-- -c <path> | --configuration=<path>] [-- --compile] [-- --exit] [-- --help] [-- --version]\n\n  A short option takes its value as the next argument, a long one joined by an equals sign.\n\n  -c <path>                    path to the JSON configuration file (default: ./conf/config.json)\n  --configuration=<path>       the same, in the long form\n  --compile                    force (re)compile the Electron client bundles from ./bin into ./tmp\n  --exit                       validate the configuration/compile and exit without starting listeners\n  -h, --help                   show this help message\n  -v, --version                show the project version");
        return;
    }

    // Verison
    const versionFlag = getArg(args, "--version", false) || getArg(args, "-v", false);
    if (versionFlag) {
        console.log(await getVersion());
        return;
    }

    // Read CLI options
    process.stdout.write("Reading arguments...    ");
    // a form the rule does not read is a value that never arrives, and the
    // fallback below would boot this server on a configuration nobody asked for
    const argError = checkArg(args, ["--configuration", "-c"]);
    if (typeof argError !== "undefined") {
        process.stdout.write("failed\n");
        console.error(argError);
        process.exitCode = 1;
        return;
    }

    // one spelling each: --configuration takes its value joined by an equals
    // sign (the inline form), -c takes the next argument
    const confPath = path.resolve(
        getArg(args, "--configuration", true, true)
        || getArg(args, "-c", true, false)
        || "./conf/config.json");
    const compileFlag = getArg(args, "--compile", false) || false;
    const exitFlag = getArg(args, "--exit", false) || false;
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

    // Start the HTTP server
    try {
        await serverHTTP.start(conf);
    } catch (error) {
        process.stdout.write("failed\n");
        console.error(error.message);
        await serverHTTP.stop();
        process.exitCode = 1;
        return;
    }

    // Start the WS server
    try {
        await serverWS.start(conf);
    } catch (error) {
        process.stdout.write("failed\n");
        console.error(error.message);
        await serverWS.stop();
        await serverHTTP.stop();
        process.exitCode = 1;
        return;
    }

    // Cleanup
    let isClosing = false;
    const close = async function() {
        if (isClosing === true) {
            return;     // a second signal while the servers are closing
        }
        isClosing = true;
        process.stdout.write("Exiting...    ");
        await serverWS.stop();
        await serverHTTP.stop();
        process.exit(0);
    };
    process.on("SIGTERM", async function() {
        process.stdout.write("SIGTERM signal received\n");
        await close();
    });
    process.on("SIGINT", async function() {
        process.stdout.write("SIGINT signal received\n");
        await close();
    });
    if (conf["flags"]["exit"] === true) {
        process.stdout.write("--exit flag received\n");
        await close();
        return;
    }
    process.stdout.write("Press CTRL+C to stop servers\n");
};
main(process.argv);
