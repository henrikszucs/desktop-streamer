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

async function deletePath(targetPath, keepDir, keepPaths = []) {
    const resolvedTarget = path.resolve(targetPath);

    let stat;
    try {
        stat = await fs.stat(resolvedTarget);
    } catch {
        return;
    }
    
    if (!stat.isDirectory()) {
        await fs.rm(resolvedTarget);
        return;
    }

    await deleteContents(resolvedTarget, resolvedTarget, keepPaths);

    if (!keepDir) {
        const remaining = await fs.readdir(resolvedTarget);
        if (remaining.length === 0) {
            await fs.rmdir(resolvedTarget);
        }
    }
}

async function deleteContents(rootPath, currentPath, keepPaths) {
    const entries = await fs.readdir(currentPath);

    for (const entry of entries) {
        const entryPath = path.join(currentPath, entry);
        const relativePath = path.relative(rootPath, entryPath).split(path.sep).join("/");

        // Exact match — skip entirely
        if (keepPaths.includes(relativePath)) {
            continue;
        }

        // Check if this entry is a parent of any keepPath
        const isParentOfKept = keepPaths.some(
            (kp) => kp.startsWith(relativePath + "/")
        );

        if (isParentOfKept) {
            // Recurse into it but don't delete it
            await deleteContents(rootPath, entryPath, keepPaths);
        } else {
            await fs.rm(entryPath, { recursive: true });
        }
    }
}

const main = async function() {
    const itemList = new Set([
		{"path": "./package-lock.json", "keepDir": false, "keepPaths": []},
        {"path": "./node_modules", "keepDir": false, "keepPaths": []},
		{"path": "./tmp", "keepDir": true, "keepPaths": ["tmp"]}
    ]);

    const binFlag = getArg(process.argv, "--bin", false); 
    if (binFlag) {
        itemList.add({"path": "./bin", "keepDir": true, "keepPaths": ["bin"]});
    }

    for (const item of itemList) {
        try {
            await deletePath(item.path, item.keepDir, item.keepPaths);
        } catch (error) {
            console.error(`Error removing ${item.path}:`, error);
        }
    }
    console.log("Cleanup completed.");
};
main();