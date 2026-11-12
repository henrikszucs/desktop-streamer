"use strict";

// Every suite that needs real input on a Mac, in one go: the hosted CI runner
// has no Accessibility permission and does not run the end-to-end suite, so
// nothing else runs these. Run it before each release, and record the result in
// the release's plan.
//
//     npm run test:mac
//
// It takes the mouse and keyboard for about a minute, and flips the system's
// mute twice, at volume 0, putting the settings back. It keeps the Mac awake
// while it runs: an idle sleep stalls the tests, past their timeouts.

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

if (os.platform() !== "darwin") {
    console.log("macOS only");
    process.exit(1);
}

const root = path.join(import.meta.dirname, "..", "..");
const require = createRequire(import.meta.url);
const { Platform } = require(path.join(root, "dist", "easy-control.cjs"));
if (!Platform.hasInputAccess()) {
    console.log("No Accessibility permission for this terminal: allow it in System Settings > Privacy & Security >\n" +
        "Accessibility, or the input tests would only skip.");
    process.exit(1);
}

spawn("caffeinate", ["-dimsu", "-w", String(process.pid)], { "stdio": "ignore", "detached": true }).unref();

const suites = [
    ["unit, with the volume test", ["--test", "test/unit/*.test.js"], { "EASYCONTROL_VOLUME_TEST": "1" }],
    ["end-to-end", ["test/e2e/run.cjs"], {}],
    ["gamepad against the stand-in for CoreHID", ["test/gamepad-stub/run.js"], {}],
    ["native", ["test/native/run.js"], {}]
];
const results = [];
for (const [name, args, env] of suites) {
    console.log("\n=== " + name + "\n");
    const start = Date.now();
    const result = spawnSync(process.execPath, args, { "cwd": root, "stdio": "inherit", "env": { ...process.env, ...env } });
    results.push([name, result.status === 0, Math.round((Date.now() - start) / 1000)]);
}

console.log("\n=== test:mac on " + os.release() + " (Darwin), " + os.arch() + "\n");
for (const [name, isPassed, seconds] of results) {
    console.log((isPassed ? "pass " : "FAIL ") + name + " (" + seconds + " s)");
}
process.exit(results.every(([, isPassed]) => isPassed) ? 0 : 1);
