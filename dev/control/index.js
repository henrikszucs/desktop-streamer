"use strict";

// npm run build                      the addon for this machine, then the JS loaders
// npm run build -- --arch arm64      the addon for another CPU (cross-compiled)
// npm run clean                      removes the build output
// npm run clean -- --all             also node_modules/ and the WDK download cache

import os from "node:os";
import process from "node:process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);


// build function; arch is the CPU to build for, the running one unless
// given (npm run build -- --arch arm64 builds the Windows ARM64 addon on x64)
const build = async (arch) => {
    const distDir = "./dist/" + os.platform() + "-" + arch + "/";

    // run node-gyp, the project's own, through this Node: no shell, and no
    // node-gyp needed on the PATH
    // nothing of a build for another CPU may be reused (on macOS the Swift
    // part is built into build_swift/)
    await fs.rm("./build/", { "recursive": true, "force": true });
    await fs.rm("./build_swift/", { "recursive": true, "force": true });
    const nodeGyp = require.resolve("node-gyp/bin/node-gyp.js");
    const ls = spawn(process.execPath, [nodeGyp, "configure", "build", "--arch=" + arch], {
        "cwd": process.cwd(),
        "stdio": "inherit"
    });
    const code = await new Promise((resolve, reject) => {
        ls.on("error", (error) => {
            reject(new Error("Build process could not be started: " + error.message));
        });
        ls.on("close", (code) => {
            console.log(`Building end with: ${code}`);
            resolve(code);
        });
    });

    if (code !== 0) {
        throw new Error("Build process failed");
    }

    // copy built files
    process.stdout.write("Copying built files...   ");
    await fs.mkdir(distDir, { "recursive": true });
    await fs.copyFile("./build/Release/easy-control.node", distDir + "easy-control.node");
    process.stdout.write("done\n");

    // minify the JS loaders into dist
    await import("./src/build.js");
};


// clean function: the build output only; with all, also what npm install
// and the gamepad build downloaded
const clean = async (isAll) => {
    process.stdout.write("Removing build output... ");
    const pathList = [
        "./build",
        "./build_swift",
        "./tmp"
    ];
    if (isAll) {
        pathList.push("./node_modules", "./build_wdk");
    }
    for (const dir of pathList) {
        try {
            await fs.rm(dir, { "recursive": true, "force": true });
        } catch (error) {
            console.error(`Error removing ${dir}:`, error);
        }
    }
    process.stdout.write("done\n");
};


// start main function
const main = async () => {
    const { values } = parseArgs({
        "options": {
            "clean": { "type": "boolean", "default": false },
            "all": { "type": "boolean", "default": false },
            "arch": { "type": "string", "default": os.arch() }
        }
    });
    if (values["clean"]) {
        await clean(values["all"]);
    } else {
        await build(values["arch"]);
    }
};
main();
