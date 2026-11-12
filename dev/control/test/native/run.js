"use strict";

// Builds and runs the native tests (test/native/*_test.cpp): plain C++
// programs over code with no system calls, so they run on every platform.
//
//     npm run test:native

import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = import.meta.dirname;
const outDir = path.join(here, "..", "..", "build", "native-tests");
await fs.mkdir(outDir, { "recursive": true });

// a command line that compiles one file into an executable
const compileCommand = async function(source, exe) {
    if (os.platform() !== "win32") {
        return ["c++", ["-std=c++17", "-O1", "-Wall", "-o", exe, source]];
    }
    // the newest Visual Studio's developer prompt
    const installer = path.join(process.env["ProgramFiles(x86)"], "Microsoft Visual Studio", "Installer");
    const { stdout } = await run(path.join(installer, "vswhere.exe"),
        ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"]);
    const vcvars = path.join(stdout.trim(), "VC", "Auxiliary", "Build", "vcvarsall.bat");
    const line = "call \"" + vcvars + "\" x64 >nul && cl /nologo /std:c++17 /EHsc /W4 /Fo\"" + outDir + "\\\\\" /Fe\"" + exe + "\" \"" + source + "\"";
    return ["cmd.exe", ["/d", "/s", "/c", "\"" + line + "\""], {
        "windowsVerbatimArguments": true, "env": { ...process.env, "PATH": installer + ";" + process.env["PATH"] }
    }];
};

let failed = 0;
for (const file of (await fs.readdir(here)).filter((name) => name.endsWith("_test.cpp"))) {
    const exe = path.join(outDir, file.replace(/\.cpp$/, os.platform() === "win32" ? ".exe" : ""));
    const [command, args, options] = await compileCommand(path.join(here, file), exe);
    const compiled = spawnSync(command, args, { "encoding": "utf8", ...options });
    if (compiled.status !== 0) {
        console.log("FAILED to build " + file + "\n" + compiled.stdout + compiled.stderr);
        failed++;
        continue;
    }
    console.log("# " + file);
    const result = spawnSync(exe, [], { "stdio": "inherit" });
    if (result.status !== 0) {
        failed++;
    }
}
process.exit(failed === 0 ? 0 : 1);
