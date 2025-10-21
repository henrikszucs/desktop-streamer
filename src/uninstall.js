"use strict";

import path from "node:path";
import fs from "node:fs/promises";

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

const main = async function() {
    const pathList = [
        "./package-lock.json",
        "./node_modules",
        "./tmp"
    ];

    const binFlag = getArg(process.argv, "--bin", false); 
    if (binFlag) {
        pathList.push("./bin");
    }

    for (const dir of pathList) {
        try {
            await fs.rm(dir, { "recursive": true, "force": true });
        } catch (error) {
            console.error(`Error removing ${dir}:`, error);
        }
    }
    console.log("Cleanup completed.");
};
main();