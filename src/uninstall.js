"use strict";

import path from "node:path";
import fs from "node:fs/promises";
import { argGet } from "./server/common.js";

async function deletePath(targetPath, keepDir, skipPaths = []) {
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

    await deleteContents(resolvedTarget, resolvedTarget, skipPaths);

    if (!keepDir) {
        const remaining = await fs.readdir(resolvedTarget);
        if (remaining.length === 0) {
            await fs.rmdir(resolvedTarget);
        }
    }
}

async function deleteContents(rootPath, currentPath, skipPaths) {
    const entries = await fs.readdir(currentPath);

    for (const entry of entries) {
        const entryPath = path.join(currentPath, entry);
        const relativePath = path.relative(rootPath, entryPath).split(path.sep).join("/");

        // Exact match — skip entirely
        if (skipPaths.includes(relativePath)) {
            continue;
        }

        // Check if this entry is a parent of any keepPath
        const isParentOfKept = skipPaths.some(
            (kp) => kp.startsWith(relativePath + "/")
        );

        if (isParentOfKept) {
            // Recurse into it but don't delete it
            await deleteContents(rootPath, entryPath, skipPaths);
        } else {
            await fs.rm(entryPath, { recursive: true });
        }
    }
}

const main = async function() {
    const helpFlag = argGet(process.argv, "--help", false) || argGet(process.argv, "-h", false);
    if (helpFlag) {
        console.log("Usage: npm run uninstall [-- --bin] [-- --help] [-- --version]\n\n  --bin        also remove ./bin\n  -h, --help   show this help message\n  -v, --version  show the project version");
        return;
    }

    const versionFlag = argGet(process.argv, "--version", false) || argGet(process.argv, "-v", false);
    if (versionFlag) {
        const packageJsonPath = path.resolve(import.meta.dirname, "../package.json");
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
        console.log(packageJson.version);
        return;
    }

    const itemList = new Set([
		{"path": "./package-lock.json", "keepDir": false, "skipPaths": []},
        {"path": "./node_modules", "keepDir": false, "skipPaths": []},
		{"path": "./tmp", "keepDir": true, "skipPaths": ["tmp"]}
    ]);

    const binFlag = argGet(process.argv, "--bin", false); 
    if (binFlag) {
        itemList.add({"path": "./bin", "keepDir": true, "skipPaths": ["bin"]});
    }

    for (const item of itemList) {
        try {
            await deletePath(item.path, item.keepDir, item.skipPaths);
        } catch (error) {
            console.error(`Error removing ${item.path}:`, error);
        }
    }
    console.log("Cleanup completed.");
};
main();