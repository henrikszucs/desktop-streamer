"use strict";

// Tests the macOS gamepad against a stand-in for CoreHID (corehid-stub.swift),
// as making a real virtual device takes an entitlement no machine here has.
// It builds a copy of the sources in a temporary directory, with the stand-in in
// place of `import CoreHID`, and runs the tests there: nothing in src/ changes
// for the tests, and dist/ is not touched.
//
//     npm run test:gamepad-stub

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (os.platform() !== "darwin") {
    console.log("macOS only, skipped");
    process.exit(0);
}

const here = import.meta.dirname;
const root = path.join(here, "..", "..");
const copy = await fs.mkdtemp(path.join(os.tmpdir(), "easy-control-gamepad-stub-"));

const run = function(command, args, env = {}) {
    const result = spawnSync(command, args, { "cwd": copy, "stdio": "inherit", "env": { ...process.env, ...env } });
    return result.status === null ? 1 : result.status;
};

let status = 1;
try {
    for (const name of ["src", "test", "binding.gyp", "index.js", "package.json"]) {
        await fs.cp(path.join(root, name), path.join(copy, name), { "recursive": true });
    }
    await fs.symlink(path.join(root, "node_modules"), path.join(copy, "node_modules"));

    const swiftPath = path.join(copy, "src", "native", "GamepadImplement.swift");
    const swift = await fs.readFile(swiftPath, "utf8");
    const stub = await fs.readFile(path.join(here, "corehid-stub.swift"), "utf8");
    if (!swift.includes("import CoreHID\n")) {
        throw new Error("GamepadImplement.swift no longer has `import CoreHID`, where the stand-in goes");
    }
    await fs.writeFile(swiftPath, swift.replace("import CoreHID\n", () => stub));

    status = run(process.execPath, ["index.js"]);
    if (status === 0) {
        // the tests that need a real pad skip everywhere else on macOS
        status = run(process.execPath, ["--test", "test/unit/gamepad.test.js"]);
        // on its own, as each process numbers its pads from 1 and this reads the log by them
        const reports = run(process.execPath, ["--test", "test/gamepad-stub/reports.test.js"], { "EC_STUB_LOG": path.join(copy, "stub.log") });
        status = status !== 0 ? status : reports;
    }
} finally {
    await fs.rm(copy, { "recursive": true, "force": true });
}
process.exit(status);
