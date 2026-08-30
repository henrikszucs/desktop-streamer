"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

// the build copies the client tree as it is, so a reference that resolves in the
// sources resolves in tmp/web, and one that does not is a 404 in both

const repoPath = path.resolve(import.meta.dirname, "..");
const webPath = path.join(repoPath, "src", "client", "web");
const electronPath = path.join(repoPath, "src", "client", "electron");
const builtWebPath = path.join(repoPath, "tmp", "web");

const ASSET_EXTENSIONS = "js|mjs|css|svg|png|jpg|jpeg|webp|mp3|json|woff2|ico|webmanifest";

const exists = async function(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        return false;
    }
};

// every "/path/to/file.ext" the file asks the server for
const rootAbsoluteRefs = function(code) {
    const pattern = new RegExp("[\"'`](\\/[A-Za-z0-9_.\\-\\/]+\\.(?:" + ASSET_EXTENSIONS + "))[\"'`]", "g");
    return [...code.matchAll(pattern)].map(function(match) {
        return match[1];
    });
};

// the module specifiers of an ES module, relative to the file holding them
const relativeImports = function(code) {
    const pattern = /(?:from|import)\s*\(?\s*["'](\.[A-Za-z0-9_.\-\/]+)["']/g;
    return [...code.matchAll(pattern)].map(function(match) {
        return match[1];
    });
};

const readIfPresent = async function(filePath) {
    try {
        return await fs.readFile(filePath, "utf8");
    } catch (error) {
        return null;
    }
};

//
// The client sources
//
test("every asset the web client requests by absolute path is in the tree", async () => {
    const files = ["index.html", path.join("src", "index.js"), "index.css"];
    let checked = 0;
    for (const file of files) {
        const code = await readIfPresent(path.join(webPath, file));
        if (code === null) {
            continue;   // index.css is allowed to disappear, the html names it
        }
        for (const ref of rootAbsoluteRefs(code)) {
            checked++;
            const target = path.join(webPath, ref);
            assert.equal(await exists(target), true, file + " asks for " + ref + " which is not in src/client/web");
        }
    }
    assert.equal(checked > 0, true, "no absolute asset references found, the scanner is broken");
});

test("every module the web client imports relatively is in the tree", async () => {
    const code = await fs.readFile(path.join(webPath, "src", "index.js"), "utf8");
    const dir = path.join(webPath, "src");
    for (const ref of relativeImports(code)) {
        assert.equal(await exists(path.resolve(dir, ref)), true, "src/index.js imports " + ref + " which is not in the tree");
    }
});

test("the Electron shell finds the assets it names in the bundle", async () => {
    // main.js runs beside the web client inside resources/app, so its relative
    // paths resolve against the web root
    const code = await fs.readFile(path.join(electronPath, "main.js"), "utf8");
    const pattern = new RegExp("[\"'`]((?:media|icons|sounds)\\/[A-Za-z0-9_.\\-\\/]+\\.(?:" + ASSET_EXTENSIONS + "))[\"'`]", "g");
    const refs = [...code.matchAll(pattern)].map(function(match) {
        return match[1];
    });
    for (const ref of refs) {
        assert.equal(await exists(path.join(webPath, ref)), true, "electron/main.js names " + ref + " which is not in src/client/web");
    }
});

test("the web client holds no reference to the folders that were renamed away", async () => {
    const files = [path.join(webPath, "index.html"), path.join(webPath, "src", "index.js")];
    for (const file of files) {
        const code = await fs.readFile(file, "utf8");
        assert.equal(/["'`]\/(icons|sounds)\//.test(code), false, path.basename(file) + " still points at the pre-rename /icons or /sounds folder");
    }
});

//
// The build output, when there is one
//
test("every asset the built client requests is in tmp/web", async (t) => {
    if (await exists(path.join(builtWebPath, "index.html")) === false) {
        t.skip("no build in ./tmp/web, run: npm run server -- --compile --exit");
        return;
    }

    const files = ["index.html", path.join("src", "index.js")];
    for (const file of files) {
        const code = await readIfPresent(path.join(builtWebPath, file));
        if (code === null) {
            continue;
        }
        for (const ref of rootAbsoluteRefs(code)) {
            assert.equal(await exists(path.join(builtWebPath, ref)), true, "built " + file + " asks for " + ref + " which is not in tmp/web");
        }
    }
});

test("the build writes the generated client files", async (t) => {
    if (await exists(path.join(builtWebPath, "index.html")) === false) {
        t.skip("no build in ./tmp/web, run: npm run server -- --compile --exit");
        return;
    }

    // config.json and version are written by the server, never copied from the sources
    const config = JSON.parse(await fs.readFile(path.join(builtWebPath, "config.json"), "utf8"));
    assert.equal(typeof config["ws"]["domain"], "string");
    assert.equal(typeof config["ws"]["port"], "number");

    const version = await fs.readFile(path.join(builtWebPath, "version"), "utf8");
    const packageJson = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf8"));
    assert.equal(version.trim(), packageJson["version"]);
});

test("every built json and script survived minification", async (t) => {
    if (await exists(path.join(builtWebPath, "index.html")) === false) {
        t.skip("no build in ./tmp/web, run: npm run server -- --compile --exit");
        return;
    }

    const files = await fs.readdir(builtWebPath, {"recursive": true});
    for (const file of files) {
        const filePath = path.join(builtWebPath, file);
        if ((await fs.stat(filePath)).isDirectory() === true) {
            continue;
        }
        const ext = path.extname(file).toLowerCase();
        if (ext === ".json") {
            const contents = await fs.readFile(filePath, "utf8");
            assert.doesNotThrow(function() {
                JSON.parse(contents);
            }, file + " is not valid JSON after the build");
        }
        if (ext === ".js" || ext === ".css" || ext === ".html") {
            assert.equal((await fs.stat(filePath)).size > 0, true, file + " is empty after the build");
        }
    }
});
