"use strict";

import os from "node:os";
import process from "node:process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";


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


// build function
const build = async () => {
    // run node-gyp
    await fs.rm("./build/", { "recursive": true, "force": true });  //for safety
    const ls = spawn("node-gyp", ["configure", "build"], {
        "cwd": process.cwd(),
        "shell": true,
        "stdio": "inherit"
    });
    let code = await new Promise((resolve) => {
        ls.on("close", (code) => {
            console.log(`Building end with: ${code}`);
            resolve(code);
        });
    });

    if (code !== 0) {
        throw new Error("Build process failed");
    }

    // copy built files
    process.stdout.write("Coping built files...    ");
    //await fs.rm("./dist/", { "recursive": true, "force": true });   // for dev
    await fs.mkdir("./dist/" + os.platform() + "-" + os.arch() + "/", { "recursive": true });

    await fs.copyFile("./src/easy-control.cjs", "./dist/easy-control.cjs");
    await fs.copyFile("./src/easy-control.mjs", "./dist/easy-control.mjs");
    
    if (os.platform() === "win32") {
        await fs.copyFile("./build/Release/easy-control.node", "./dist/" + os.platform() + "-" + os.arch() + "/easy-control.node");
        const deps = [
            "./src/inc/ViGEm/lib/ViGEmClient.dll", "./dist/" + os.platform() + "-" + os.arch() + "/ViGEmClient.dll",
            "./src/inc/ViGEm/lib/ViGEmClient.lib", "./dist/" + os.platform() + "-" + os.arch() + "/ViGEmClient.lib"
        ];
        for (let i = 0; i < deps.length; i += 2) {
            await fs.cp(deps[i], deps[i + 1]), { "recursive": true };
        }
    } else if (os.platform() === "darwin") {
        await fs.copyFile("./build/Release/easy-control.node", "./dist/" + os.platform() + "-" + os.arch() + "/easy-control.node");
        await fs.copyFile("./build/Release/GamepadImplement.a", "./dist/" + os.platform() + "-" + os.arch() + "/GamepadImplement.a");
        await fs.copyFile("./build/Release/nothing.a", "./dist/" + os.platform() + "-" + os.arch() + "/nothing.a");
    } else if (os.platform() === "linux") {
        await fs.copyFile("./build/Release/easy-control.node", "./dist/" + os.platform() + "-" + os.arch() + "/easy-control.node");
    }

    // test environment copy
    /*
    const distSrc = "./dist/";
    const distDest = "./dev/test/resources/app/dist/";
    await fs.mkdir(distDest, { "recursive": true });
    const distFiles = await fs.readdir(distSrc, {"recursive": true});
    for (const file of distFiles) {
        const fileSrc = path.join(distSrc, file);
        const fileDest = path.join(distDest, file);
        const isDir = (await fs.stat(fileSrc)).isDirectory();
        if (isDir) {
            await fs.mkdir(fileDest, {"recursive": true});
        } else {
            await fs.cp(fileSrc, fileDest), { "recursive": true };
        }
    }*/

    process.stdout.write("done\n");
};


// uninstall function
const uninstall = async () => {
    process.stdout.write("Removing built files...  ");
    const pathList = [
        "./package-lock.json",
        "./node_modules",
        "./build",
        "./.vscode",
        "./tmp",
        "./build_swift"
    ];
    for (const dir of pathList) {
        try {
            await fs.rm(dir, { "recursive": true, "force": true });
        } catch (error) {
            console.error(`Error removing ${dir}:`, error);
        }
    }

    /*
    const distSrc = "./dev/test";
    const distFiles = await fs.readdir(distSrc);
    for (const file of distFiles) {
        const fileSrc = path.join(distSrc, file);
        const isDir = (await fs.stat(fileSrc)).isDirectory();
        if (!isDir) {
            await fs.rm(fileSrc);
        }
    }*/

    process.stdout.write("done\n");
};


// start main function
const main = async () => {
    const uninstallFlag = getArg(process.argv, "--uninstall", false) || false;
    if (uninstallFlag) {
        await uninstall();
    } else {
        await build();
    }
};
main();