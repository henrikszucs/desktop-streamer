"use strict";

// Builds the Windows virtual gamepad (src/native/windows-gamepad) for x64 and
// ARM64 (when Visual Studio has the MSVC ARM64 build tools) into
// dist/win32-<arch>/gamepad:
//
//     easycontrol_gamepad.dll                 UMDF 2 driver, for both devices of a pad
//     easycontrol_gamepad.inf / .cat          its package for the HID device
//     easycontrol_xusb.inf / .cat             its package for the XUSB device
//                                             (catalogs unsigned: the setup script signs
//                                             them on the user's machine)
//     easy-control-gamepad-service.exe        broker service
//     easy-control-gamepad-setup.ps1          installer
//
//     npm run build:gamepad
//
// Needs Visual Studio with the C++ tools. The parts of the Windows Driver Kit
// it uses (UMDF headers and stub library, Inf2Cat) come from Microsoft's WDK
// NuGet package, downloaded once into build_wdk/, so the WDK need not be
// installed.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const rootPath = path.join(import.meta.dirname, "..");
const pkg = JSON.parse(await fs.readFile(path.join(rootPath, "package.json"), "utf8"));
const srcDir = path.join(rootPath, "src", "native", "windows-gamepad");
const wdkDir = path.join(rootPath, "build_wdk");
const buildDir = path.join(rootPath, "build", "gamepad");

const WDK_VERSION = "10.0.26100.6584";
const SDK_VERSION = "10.0.26100.0";
const UMDF_VERSION = "2.15";    // Windows 10 1507 and later

// the driver packages, each an INF with its catalog, both with the one DLL
const INFS = ["easycontrol_gamepad", "easycontrol_xusb"];

// each architecture built, when Visual Studio has its compiler
const ARCHS = {
    "x64": {
        "vcvars": "x64",
        "component": "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "wdkPackage": "microsoft.windows.wdk.x64",
        "inf": "amd64",
        "catalogOs": "10_19H1_X64"
    },
    "arm64": {
        "vcvars": "x64_arm64",      // cross-compiled on an x64 machine
        "component": "Microsoft.VisualStudio.Component.VC.Tools.ARM64",
        "wdkPackage": "microsoft.windows.wdk.arm64",
        "inf": "arm64",
        "catalogOs": "10_19H1_ARM64"
    }
};

if (os.platform() !== "win32") {
    console.log("The virtual gamepad driver is built on Windows only");
    process.exit(0);
}

const exists = async function(file) {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
};

// a WDK NuGet package, unpacked: only the parts used here. The x64 package
// also has the headers and the tools, which run on the build machine; the
// others add their architecture's libraries.
const ensureWdk = async function(packageId) {
    const marker = path.join(wdkDir, "wdk", packageId + "-" + WDK_VERSION + "-2.done");
    if (await exists(marker)) {
        return;
    }
    await fs.mkdir(path.join(wdkDir, "wdk"), { "recursive": true });
    const nupkg = path.join(wdkDir, packageId + "." + WDK_VERSION + ".nupkg");
    if (!await exists(nupkg)) {
        const url = "https://api.nuget.org/v3-flatcontainer/" + packageId + "/" + WDK_VERSION + "/" + packageId + "." + WDK_VERSION + ".nupkg";
        console.log("Downloading " + packageId + "...");
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Downloading " + url + " failed: " + response.status);
        }
        await fs.writeFile(nupkg, Buffer.from(await response.arrayBuffer()));
    }
    console.log("Unpacking the parts of " + packageId + "...");
    const prefixes = packageId === ARCHS["x64"]["wdkPackage"] ? [
        "c/Include/wdf/umdf/" + UMDF_VERSION + "/",
        "c/Include/" + SDK_VERSION + "/km/hidport.h",
        "c/Lib/wdf/umdf/",
        "c/bin/" + SDK_VERSION + "/x86/",
        "c/tools//" + SDK_VERSION + "/x64/infverif.exe"
    ] : [
        "c/Lib/wdf/umdf/"
    ];
    const script = [
        "Add-Type -AssemblyName System.IO.Compression.FileSystem",
        "$zip = [IO.Compression.ZipFile]::OpenRead($env:NUPKG)",
        "$prefixes = $env:PREFIXES -split '\\|'",
        "foreach ($e in $zip.Entries) {",
        "  if (-not $e.Name) { continue }",
        "  if (-not ($prefixes | Where-Object { $e.FullName.StartsWith($_) })) { continue }",
        "  $dest = Join-Path $env:DEST ($e.FullName -replace '/', '\\')",
        "  New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null",
        "  [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)",
        "}",
        "$zip.Dispose()"
    ].join("\n");
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        "env": { ...process.env, "NUPKG": nupkg, "DEST": path.join(wdkDir, "wdk"), "PREFIXES": prefixes.join("|") },
        "maxBuffer": 1 << 26
    });
    await fs.writeFile(marker, "");
};

// vcvarsall.bat of the newest Visual Studio with the compiler for the
// architecture, or null when there is none
const findVcvars = async function(arch) {
    const vswhere = path.join(process.env["ProgramFiles(x86)"], "Microsoft Visual Studio", "Installer", "vswhere.exe");
    const { stdout } = await run(vswhere, ["-latest", "-products", "*", "-requires",
        ARCHS[arch]["component"], "-property", "installationPath"]);
    const vcvars = path.join(stdout.trim(), "VC", "Auxiliary", "Build", "vcvarsall.bat");
    return stdout.trim() && await exists(vcvars) ? vcvars : null;
};

// runs commands in a developer prompt for the architecture
const runInVcEnv = async function(vcvars, target, commands, cwd) {
    const line = "call \"" + vcvars + "\" " + target + " >nul && " + commands.join(" && ");
    // vcvarsall looks for vswhere.exe on the PATH
    const installer = path.join(process.env["ProgramFiles(x86)"], "Microsoft Visual Studio", "Installer");
    try {
        const { stdout } = await run("cmd.exe", ["/d", "/s", "/c", "\"" + line + "\""], {
            "cwd": cwd, "windowsVerbatimArguments": true, "maxBuffer": 1 << 26,
            "env": { ...process.env, "PATH": installer + ";" + process.env["PATH"] }
        });
        return stdout;
    } catch (error) {
        throw new Error("Build failed:\n" + (error.stdout || "") + (error.stderr || ""));
    }
};

const padVersion = async function() {
    const header = await fs.readFile(path.join(srcDir, "common", "easycontrol_pad.h"), "utf8");
    return header.match(/#define EASYCONTROL_PAD_VERSION (\d+)/)[1];
};

const buildArch = async function(vcvars, arch, version) {
    const { "vcvars": target, "inf": infArch, "catalogOs": catalogOs } = ARCHS[arch];
    const out = path.join(buildDir, arch);
    const dist = path.join(rootPath, "dist", "win32-" + arch, "gamepad");
    await fs.rm(out, { "recursive": true, "force": true });
    await fs.mkdir(path.join(out, "package"), { "recursive": true });

    // hidport.h alone, so the rest of the kernel headers cannot shadow the SDK's
    const extraInclude = path.join(out, "include");
    await fs.mkdir(extraInclude, { "recursive": true });
    await fs.copyFile(path.join(wdkDir, "wdk", "c", "Include", SDK_VERSION, "km", "hidport.h"), path.join(extraInclude, "hidport.h"));

    const umdfInclude = path.join(wdkDir, "wdk", "c", "Include", "wdf", "umdf", UMDF_VERSION);
    const umdfLib = path.join(wdkDir, "wdk", "c", "Lib", "wdf", "umdf", arch, UMDF_VERSION, "WdfDriverStubUm.lib");
    if (!await exists(umdfLib)) {
        throw new Error("No UMDF stub library for " + arch + " in the WDK package");
    }
    // C4324: padding the WDF headers ask for themselves
    const common = "/nologo /O2 /W4 /wd4324 /GS /guard:cf /MT /DUNICODE /D_UNICODE /D_WIN32_WINNT=0x0A00";
    const pkgDir = path.join(out, "package");

    console.log("Compiling the driver and the service (" + arch + ")...");
    await runInVcEnv(vcvars, target, [
        // driver
        "cl " + common + " /c /Fo\"" + path.join(out, "driver.obj") + "\"" +
            " /I\"" + umdfInclude + "\" /I\"" + extraInclude + "\" \"" + path.join(srcDir, "driver", "driver.c") + "\"",
        "link /nologo /DLL /OUT:\"" + path.join(pkgDir, "easycontrol_gamepad.dll") + "\" \"" + path.join(out, "driver.obj") + "\"" +
            " \"" + umdfLib + "\" kernel32.lib ntdll.lib /EXPORT:FxDriverEntryUm /SUBSYSTEM:WINDOWS /NXCOMPAT /DYNAMICBASE /guard:cf",
        // service
        "cl " + common + " /EHsc /std:c++17 /Fo\"" + path.join(out, "service.obj") + "\"" +
            " /Fe\"" + path.join(out, "easy-control-gamepad-service.exe") + "\" \"" + path.join(srcDir, "service", "service.cpp") + "\"" +
            " /link swdevice.lib ole32.lib advapi32.lib /NXCOMPAT /DYNAMICBASE /guard:cf"
    ], out);

    // the INF, from the template
    const now = new Date();
    const date = String(now.getMonth() + 1).padStart(2, "0") + "/" + String(now.getDate()).padStart(2, "0") + "/" + now.getFullYear();
    const driverVer = date + "," + pkg["version"].replace(/[^0-9.]/g, "") + "." + version;
    // one INF per device of a pad: the HID device must be HIDClass, the XUSB
    // device System
    const infverif = path.join(wdkDir, "wdk", "c", "tools", SDK_VERSION, "x64", "infverif.exe");
    for (const name of INFS) {
        const inx = await fs.readFile(path.join(srcDir, "driver", name + ".inx"), "utf8");
        const inf = inx.replaceAll("$ARCH$", infArch).replaceAll("$UMDFVERSION$", UMDF_VERSION + ".0").replaceAll("$DRIVERVER$", driverVer);
        await fs.writeFile(path.join(pkgDir, name + ".inf"), inf.replace(/\r?\n/g, "\r\n"));
        // checked as Windows checks a driver package
        try {
            await run(infverif, ["/w", path.join(pkgDir, name + ".inf")]);
        } catch (error) {
            throw new Error("InfVerif found problems in " + name + ".inf:\n" + (error.stdout || "") + (error.stderr || ""));
        }
    }

    // the catalogs, unsigned
    console.log("Making the catalogs...");
    const inf2cat = path.join(wdkDir, "wdk", "c", "bin", SDK_VERSION, "x86", "Inf2Cat.exe");
    try {
        await run(inf2cat, ["/driver:" + pkgDir, "/os:" + catalogOs, "/uselocaltime"], { "maxBuffer": 1 << 24 });
    } catch (error) {
        throw new Error("Inf2Cat failed:\n" + (error.stdout || "") + (error.stderr || ""));
    }

    // dist
    await fs.rm(dist, { "recursive": true, "force": true });
    await fs.mkdir(dist, { "recursive": true });
    for (const file of [...INFS.flatMap((name) => [name + ".inf", name + ".cat"]), "easycontrol_gamepad.dll"]) {
        await fs.copyFile(path.join(pkgDir, file), path.join(dist, file));
    }
    await fs.copyFile(path.join(out, "easy-control-gamepad-service.exe"), path.join(dist, "easy-control-gamepad-service.exe"));
    const setup = await fs.readFile(path.join(srcDir, "setup", "easy-control-gamepad-setup.ps1"), "utf8");
    // Windows PowerShell 5.1 reads a script without a BOM as ANSI
    await fs.writeFile(path.join(dist, "easy-control-gamepad-setup.ps1"),
        "﻿" + setup.replaceAll("$PAD_VERSION$", version).replace(/\r?\n/g, "\r\n"));
    // the version these files are, which the addon (built apart from them)
    // reports as getDriverStatus().available
    await fs.writeFile(path.join(dist, "version.json"), JSON.stringify({ "version": Number(version) }) + "\n");

    for (const file of await fs.readdir(dist)) {
        const size = (await fs.stat(path.join(dist, file))).size;
        console.log("  dist/win32-" + arch + "/gamepad/" + file.padEnd(36) + (size / 1024).toFixed(1).padStart(7) + " kB");
    }
};

const version = await padVersion();
await ensureWdk(ARCHS["x64"]["wdkPackage"]);
let built = 0;
for (const arch of Object.keys(ARCHS)) {
    const vcvars = await findVcvars(arch);
    if (vcvars === null) {
        console.log("Skipping " + arch + ": Visual Studio has no compiler for it (component " + ARCHS[arch]["component"] + ")");
        continue;
    }
    await ensureWdk(ARCHS[arch]["wdkPackage"]);
    await buildArch(vcvars, arch, version);
    built++;
}
if (built === 0) {
    throw new Error("Visual Studio with the C++ tools was not found");
}
