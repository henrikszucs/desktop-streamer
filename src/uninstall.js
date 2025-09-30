"use strict";

import path from "node:path";
import fs from "node:fs/promises";


const main = async function() {
    const pathList = [
        "./package-lock.json",
        "./node_modules",
        "./tmp",
        "./src/client/electron/dist"
    ];
    for (const dir of pathList) {
        try {
            await fs.rm(dir, { recursive: true, force: true });
        } catch (error) {
            console.error(`Error removing ${dir}:`, error);
        }
    }
    console.log("Cleanup completed.");
};
main();