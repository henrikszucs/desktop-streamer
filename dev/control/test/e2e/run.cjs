"use strict";

// Starts the e2e app in Electron. ELECTRON_RUN_AS_NODE, which VS Code sets
// for the processes it starts, would run it as plain Node without a window.

const { spawn } = require("node:child_process");

const electronPath = require("electron");   // the binary's path, from Node

const env = Object.assign({}, process.env);
delete env["ELECTRON_RUN_AS_NODE"];

const child = spawn(electronPath, [__dirname], { "stdio": "inherit", "env": env });
child.on("close", function(code, signal) {
    if (signal) {
        console.error("Electron ended by " + signal);
    }
    process.exit(code === null ? 1 : code);
});
