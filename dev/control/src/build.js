"use strict";
import path from "node:path";
import * as fs from "node:fs/promises";

import * as esbuild from "esbuild";

const rootPath = path.join(import.meta.dirname, "..");
const pkg = JSON.parse(await fs.readFile(path.join(rootPath, "package.json"), "utf8"));

const conf = {
    "srcDir": path.join(rootPath, "src"),
    "outDir": path.join(rootPath, "dist")
};

const banner = "/*! " + pkg["name"] + " v" + pkg["version"] + " | " + pkg["license"] + " | " + pkg["repository"]["url"] + " */";

// [file name, format]
// Not bundled: the .cjs loads the native addon for the running platform at
// run time, and the .mjs imports that .cjs, so each file is only minified.
const outputs = [
    ["easy-control.cjs", "cjs"],    // CommonJS (require)
    ["easy-control.mjs", "esm"]     // ES module (import)
];

// minify one loader file into dist
const buildScript = async function(file, format) {
    await esbuild.build({
        "entryPoints": [path.join(conf["srcDir"], file)],
        "outfile": path.join(conf["outDir"], file),
        "bundle": false,
        "platform": "node",
        "format": format,
        "minify": true,
        "legalComments": "none",
        "banner": {"js": banner},
        "logLevel": "warning"
    });
};

// dist also holds the native builds of every platform, so only the loader
// files are replaced, never the whole folder
await fs.mkdir(conf["outDir"], {"recursive": true});

await Promise.all(outputs.map(function([file, format]) {
    return buildScript(file, format);
}));

// the type definitions: the same for require, plus the default export for
// import (a CommonJS module has none)
const types = banner + "\n" + await fs.readFile(path.join(conf["srcDir"], "easy-control.d.ts"), "utf8");
await fs.writeFile(path.join(conf["outDir"], "easy-control.d.cts"), types);
await fs.writeFile(path.join(conf["outDir"], "easy-control.d.mts"), types +
    "\ndeclare const easyControl: {\n" +
    "    Mouse: Mouse;\n    Keyboard: Keyboard;\n    Gamepad: Gamepad;\n    Screen: Screen;\n    Platform: Platform;\n" +
    "};\nexport default easyControl;\n");
outputs.push(["easy-control.d.cts"], ["easy-control.d.mts"]);

for (const [file] of outputs) {
    const code = await fs.readFile(path.join(conf["outDir"], file));
    const size = (code.byteLength / 1024).toFixed(2);
    console.log("  dist/" + file.padEnd(20) + size.padStart(6) + " kB");
}
