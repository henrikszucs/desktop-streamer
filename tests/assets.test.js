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

const ASSET_EXTENSIONS = "js|mjs|css|html|svg|png|jpg|jpeg|webp|mp3|json|woff2|ico|webmanifest";
const SCANNED_EXTENSIONS = [".js", ".mjs", ".html", ".css"];

const exists = async function(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        return false;
    }
};

// every file of the client the scanners below have anything to say about, the
// client is a tree of small modules now so a fixed list would check almost none
const clientFiles = async function(basePath) {
    const found = [];
    let entries;
    try {
        entries = await fs.readdir(basePath, {"recursive": true});
    } catch (error) {
        return found;
    }
    for (const entry of entries) {
        const filePath = path.join(basePath, entry);
        if (SCANNED_EXTENSIONS.includes(path.extname(entry).toLowerCase()) === false) {
            continue;
        }
        if (entry.split(path.sep).includes("libs") === true) {
            continue;   // vendored, it answers to its own upstream
        }
        if ((await fs.stat(filePath)).isDirectory() === true) {
            continue;
        }
        found.push(entry);
    }
    return found;
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
    const files = await clientFiles(webPath);
    assert.equal(files.length > 0, true, "no client files found, the walker is broken");

    let checked = 0;
    for (const file of files) {
        const code = await fs.readFile(path.join(webPath, file), "utf8");
        for (const ref of rootAbsoluteRefs(code)) {
            checked++;
            const target = path.join(webPath, ref);
            assert.equal(await exists(target), true, file + " asks for " + ref + " which is not in src/client/web");
        }
    }
    assert.equal(checked > 0, true, "no absolute asset references found, the scanner is broken");
});

test("every module the web client imports relatively is in the tree", async () => {
    const files = await clientFiles(webPath);

    let checked = 0;
    for (const file of files) {
        if (path.extname(file).toLowerCase() === ".css") {
            continue;
        }
        const code = await fs.readFile(path.join(webPath, file), "utf8");
        const dir = path.dirname(path.join(webPath, file));
        for (const ref of relativeImports(code)) {
            checked++;
            assert.equal(await exists(path.resolve(dir, ref)), true, file + " imports " + ref + " which is not in the tree");
        }
    }
    assert.equal(checked > 0, true, "no relative imports found, the scanner is broken");
});

//
// The registry, the one table that names every UI module
//
test("every UI module folder is in the registry", async () => {
    const registry = await fs.readFile(path.join(webPath, "src", "registry.js"), "utf8");
    const registered = new Set([...registry.matchAll(/import\("(\.\.\/ui\/[^"]+)"\)/g)].map(function(match) {
        return match[1].replace("../ui/", "").replace("/index.js", "");
    }));

    const uiPath = path.join(webPath, "ui");
    const entries = await fs.readdir(uiPath, {"recursive": true});
    const missing = [];
    for (const entry of entries) {
        if (path.basename(entry) !== "index.js") {
            continue;
        }
        const id = path.dirname(entry).split(path.sep).join("/");
        if (registered.has(id) === false) {
            missing.push(id);
        }
    }
    assert.deepEqual(missing, [], "UI modules with no entry in src/registry.js");
});

test("every markup and stylesheet the registry names is in the tree", async () => {
    const registry = await fs.readFile(path.join(webPath, "src", "registry.js"), "utf8");
    const refs = [...registry.matchAll(/"(?:html|css|localization)": "([^"]+)"/g)].map(function(match) {
        return match[1];
    });
    assert.equal(refs.length > 0, true, "no view files found in the registry, the scanner is broken");

    for (const ref of refs) {
        assert.equal(await exists(path.join(webPath, ref)), true, "the registry names " + ref + " which is not in the tree");
    }
});

test("every mount point a UI module asks for is in the shell or in another module", async () => {
    const files = await clientFiles(webPath);

    // the ids the markup of the client defines, wherever it lives
    const ids = new Set();
    for (const file of files) {
        if (path.extname(file).toLowerCase() !== ".html") {
            continue;
        }
        const markup = await fs.readFile(path.join(webPath, file), "utf8");
        for (const match of markup.matchAll(/id="([^"]+)"/g)) {
            ids.add(match[1]);
        }
    }

    const missing = [];
    for (const file of files) {
        if (path.extname(file).toLowerCase() !== ".js") {
            continue;
        }
        const code = await fs.readFile(path.join(webPath, file), "utf8");
        for (const match of code.matchAll(/static mountPoint = "#([^"]+)"/g)) {
            if (ids.has(match[1]) === false) {
                missing.push(file + " -> #" + match[1]);
            }
        }
        for (const match of code.matchAll(/static rootId = "([^"]+)"/g)) {
            if (ids.has(match[1]) === false) {
                missing.push(file + " -> " + match[1]);
            }
        }
    }
    assert.deepEqual(missing, [], "mount points and roots that no markup defines");
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
    for (const file of await clientFiles(webPath)) {
        const code = await fs.readFile(path.join(webPath, file), "utf8");
        assert.equal(/["'`]\/(icons|sounds)\//.test(code), false, file + " still points at the pre-rename /icons or /sounds folder");
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

    const files = await clientFiles(builtWebPath);
    assert.equal(files.length > 0, true, "no built client files found, the walker is broken");
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
