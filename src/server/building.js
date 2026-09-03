"use strict";

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import process from "node:process";

// third-party dependencies
import UglifyJS from "uglify-js";

// first-party dependencies
import { serverScriptPath, getVersion } from "./common.js";
import { readZip, writeZip } from "./zip.js";

//
// Constants
//
// the built web client is served from this subfolder of the compile path
const WEB_DIR = "web";

// the desktop client zips are downloaded from this subfolder of the compile path
const DESKTOP_DIR = "desktop";

// squeeze the zips as hard as deflate allows, they are downloaded over the wire
const ZIP_LEVEL = 9;

// what a dist is called while it is still being written
const PART_SUFFIX = ".part";

// the client configuration the server generates for the built clients
const CONF_FILE = "index.json";

// written by the build, never copied from the sources
const GENERATED_FILES = new Set([CONF_FILE]);

const WHITESPACE = " \t\r\n\f";

// zip entries are always separated by "/", never by the platform separator
const zipPath = function(...parts) {
    return path.join(...parts).split(path.sep).join("/");
};

//
// Minifiers
//
// minify a script, isModule=false parses it as CommonJS (the Electron shell)
const minifyScript = function(code, isModule=true) {
    const result = UglifyJS.minify(code, {
        "module": isModule,
        "compress": {},
        "mangle": true,
        "output": {"comments": false}
    });
    if (typeof result["error"] !== "undefined") {
        throw new Error(result["error"]["message"]);
    }
    return result["code"];
};

// minify a stylesheet: drop the comments and every space the parser ignores
const minifyStyle = function(code) {
    const separators = "{};,";
    const length = code.length;
    let out = "";
    let index = 0;
    let isSkipSpace = true;     // no leading space, and none after a separator
    while (index < length) {
        const char = code[index];

        // strings are copied verbatim, they may hold anything
        if (char === "\"" || char === "'") {
            let end = index + 1;
            while (end < length && code[end] !== char) {
                end += (code[end] === "\\" ? 2 : 1);
            }
            out += code.slice(index, end + 1);
            index = end + 1;
            isSkipSpace = false;
            continue;
        }

        // comments never reach the browser
        if (char === "/" && code[index + 1] === "*") {
            const end = code.indexOf("*/", index + 2);
            index = (end === -1 ? length : end + 2);
            continue;
        }

        // any run of whitespace means at most a single space
        if (WHITESPACE.includes(char)) {
            while (index < length && WHITESPACE.includes(code[index])) {
                index++;
            }
            if (isSkipSpace === false) {
                out += " ";
            }
            continue;
        }

        // a separator needs no space around it, a colon none behind it
        // (the space in front of a colon stays, selectors like "a :hover" need it)
        if (separators.includes(char) || char === ":") {
            if (char !== ":" && out.endsWith(" ")) {
                out = out.slice(0, -1);
            }
            if (char === "}" && out.endsWith(";")) {
                out = out.slice(0, -1);     // last declaration of a block
            }
            out += char;
            index++;
            isSkipSpace = true;
            continue;
        }

        out += char;
        index++;
        isSkipSpace = false;
    }
    return out.trim();
};

// collapse the whitespace of a single tag, leaving the attribute values alone
const minifyTag = function(tag) {
    const length = tag.length;
    let out = "";
    let index = 0;
    while (index < length) {
        const char = tag[index];
        if (char === "\"" || char === "'") {
            const end = tag.indexOf(char, index + 1);
            const stop = (end === -1 ? length - 1 : end);
            out += tag.slice(index, stop + 1);
            index = stop + 1;
            continue;
        }
        if (WHITESPACE.includes(char)) {
            while (index < length && WHITESPACE.includes(tag[index])) {
                index++;
            }
            out += " ";
            continue;
        }
        out += char;
        index++;
    }
    return out.replace(/ (\/?)>$/, "$1>");
};

// find the ">" that closes a tag, skipping the quoted attribute values
const findTagEnd = function(code, start) {
    const length = code.length;
    let index = start;
    while (index < length) {
        const char = code[index];
        if (char === "\"" || char === "'") {
            const end = code.indexOf(char, index + 1);
            index = (end === -1 ? length : end + 1);
            continue;
        }
        if (char === ">") {
            return index;
        }
        index++;
    }
    return -1;
};

// elements whose content is text, not markup
const RAW_TAGS = ["pre", "textarea", "script", "style"];

// minify markup: drop the comments and collapse the whitespace the way the
// renderer does anyway (a run of whitespace is a single space outside RAW_TAGS)
const minifyMarkup = function(code) {
    const length = code.length;
    let out = "";
    let index = 0;
    while (index < length) {
        const next = code.indexOf("<", index);

        // the text left after the last tag
        if (next === -1) {
            out += code.slice(index).replace(/[ \t\r\n\f]+/g, " ");
            break;
        }
        out += code.slice(index, next).replace(/[ \t\r\n\f]+/g, " ");

        // comments carry nothing to the browser
        if (code.startsWith("<!--", next)) {
            const end = code.indexOf("-->", next + 4);
            index = (end === -1 ? length : end + 3);
            continue;
        }

        // the tag itself
        const tagEnd = findTagEnd(code, next);
        if (tagEnd === -1) {
            out += code.slice(next).replace(/[ \t\r\n\f]+/g, " ");
            break;
        }
        const tag = code.slice(next, tagEnd + 1);
        out += minifyTag(tag);
        index = tagEnd + 1;

        // raw text elements keep their content, inline code gets its own minifier
        const name = (/^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag) ?? [])[1]?.toLowerCase();
        if (RAW_TAGS.includes(name) === false || tag.endsWith("/>")) {
            continue;
        }
        const close = code.toLowerCase().indexOf("</" + name, index);
        const end = (close === -1 ? length : close);
        let raw = code.slice(index, end);
        if (raw.trim() !== "") {
            if (name === "script") {
                raw = minifyScript(raw, /type\s*=\s*["']module["']/.test(tag));
            } else if (name === "style") {
                raw = minifyStyle(raw);
            }
        }
        out += raw;
        index = end;
    }
    return out.trim();
};

//
// Building
//
// minify one client file, falling back to the original bytes when it cannot be
const buildFile = async function(filePath, isModule=true) {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    try {
        if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
            const asModule = (ext === ".mjs" ? true : (ext === ".cjs" ? false : isModule));
            return Buffer.from(minifyScript(data.toString("utf8"), asModule), "utf8");
        }
        if (ext === ".css") {
            return Buffer.from(minifyStyle(data.toString("utf8")), "utf8");
        }
        if (ext === ".html" || ext === ".htm") {
            return Buffer.from(minifyMarkup(data.toString("utf8")), "utf8");
        }
        if (ext === ".json" || ext === ".webmanifest") {
            return Buffer.from(JSON.stringify(JSON.parse(data.toString("utf8"))), "utf8");
        }
    } catch (error) {
        process.stdout.write("\n    Cannot minify " + filePath + " (" + error.message + "), copying as is    ");
    }
    return data;
};

// build a whole client folder into [{path, data}], the source layout is kept
const buildFolder = async function(srcPath, isModule=true, skip=new Set()) {
    const built = [];
    const files = await fs.readdir(srcPath, {"recursive": true});
    for (const file of files) {
        if (skip.has(file)) {
            continue;
        }
        const filePath = path.join(srcPath, file);
        if ((await fs.stat(filePath)).isDirectory()) {
            continue;   // readdir already lists the files inside
        }
        built.push({
            "path": file,
            "data": await buildFile(filePath, isModule)
        });
    }
    return built;
};

// the client configuration file the built clients read: the version, the domain
// and port of each of the two servers, and the desktop clients this build makes
//
// The two servers are configured apart and may be reached at different
// addresses, so each gets its own section. The WS half is the remote server when
// one is configured, and the local one otherwise - which answers on the HTTP
// domain when it shares the host with it.
//
// The client list is the targets this compile is about to write, so the download
// screen offers exactly the zips that end up beside it and never a link to a
// target this server was not built for. Every dist is handed the same file, so a
// desktop client knows about its siblings too.
const buildConfFile = async function(conf, dists = []) {
    const confData = {
        "version": await getVersion(),
        "http": {},
        "ws": {},
        "clients": dists.map(function(dist) {
            return dist["os"] + "-" + dist["arch"] + ".zip";
        })
    };
    if (typeof conf["http"] === "object") {
        confData["http"]["domain"] = conf["http"]["domain"];
        confData["http"]["port"] = conf["http"]["port"];
    }
    if (typeof conf["http"] === "object" && typeof conf["http"]["remote"] === "object") {
        confData["ws"]["domain"] = conf["http"]["remote"]["host"];
        confData["ws"]["port"] = conf["http"]["remote"]["port"];
    } else {
        if (typeof conf["http"] === "object") {
            confData["ws"]["domain"] = conf["http"]["domain"];
        } else {
            confData["ws"]["domain"] = conf["ws"]["domain"];
        }
        confData["ws"]["port"] = conf["ws"]["port"];
    }
    return JSON.stringify(confData);
};

// write the built web client to <compilePath>/web
const writeWeb = async function(webDestPath, webFiles, confFile) {
    await fs.mkdir(webDestPath, {"recursive": true});
    for (const file of webFiles) {
        const destPath = path.join(webDestPath, file["path"]);
        await fs.mkdir(path.dirname(destPath), {"recursive": true});
        await fs.writeFile(destPath, file["data"]);
    }
    await fs.writeFile(path.join(webDestPath, CONF_FILE), confFile);
};

// the Electron dist as zip entries, without its default app
//
// A dist that is already a zip is taken over entry by entry with its bytes still
// deflated: it is the bulk of the output, and deflating it again would cost more
// than everything else the build does put together.
const packDist = async function(dist) {
    let asarFile = path.join("resources", "default_app.asar");
    if (dist["os"] === "darwin") {
        asarFile = path.join("Electron.app", "Contents", "Resources", "default_app.asar");
    }

    const entries = [];
    if (dist["isZip"] === true) {
        for (const entry of readZip(await fs.readFile(dist["path"]))) {
            if (entry["name"] === zipPath(asarFile)) {
                continue;
            }
            entries.push(entry);
        }
        return entries;
    }

    const files = await fs.readdir(dist["path"], {"recursive": true});
    const asarIndex = files.indexOf(asarFile);
    if (asarIndex !== -1) {
        files.splice(asarIndex, 1);
    }
    for (const file of files) {
        const filePath = path.join(dist["path"], file);
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
            entries.push({"name": zipPath(file) + "/", "isDir": true, "mode": stat.mode, "date": stat.mtime});
        } else {
            entries.push({"name": zipPath(file), "path": filePath, "mode": stat.mode, "date": stat.mtime});
        }
    }
    return entries;
};

// stream one dist zip to disk, the whole thing never stands in memory at once
//
// It is written beside the target and moved onto it only once it is whole. The
// caller catches a failed dist and carries on to the next target, so a stream
// opened at the final name left a truncated zip exactly where http.js serves
// the downloads from - offered to clients as a client.
const writeDistZip = async function(destPath, entries) {
    const partPath = destPath + PART_SUFFIX;
    try {
        const stream = createWriteStream(partPath);
        try {
            await writeZip(stream, entries, ZIP_LEVEL);
        } finally {
            await new Promise(function(resolve, reject) {
                stream.once("error", reject);
                stream.end(resolve);
            });
        }
        await fs.rename(partPath, destPath);
    } catch (error) {
        await fs.rm(partPath, {"force": true});
        throw error;
    }
};

// compile the desktop clients into <compilePath>/desktop/<os>-<arch>.zip and the
// web client into <compilePath>/web, minified and deflated to keep the transfer small
const compileClients = async function(conf) {

    // secure in/out folders
    const sourcePath = path.join("./bin");
    const compilePath = path.join("./tmp");
    const webDestPath = path.join(compilePath, WEB_DIR);
    const desktopDestPath = path.join(compilePath, DESKTOP_DIR);
    for (const dirPath of [sourcePath, compilePath, desktopDestPath]) {
        try {
            await fs.access(dirPath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (error) {
            // create the path if it does not exist
            try {
                await fs.mkdir(dirPath, {"recursive": true});
            } catch (error) {
                throw new Error("Cannot create path: " + dirPath + " - " + error.message);
            }
        }
    }

    // exit if compile is not requested and the web client is already built
    let isBuilt = true;
    try {
        await fs.access(path.join(webDestPath, "index.html"), fs.constants.R_OK);
    } catch (error) {
        isBuilt = false;
    }
    if (conf["flags"]["compile"] === false && isBuilt) {
        return false;
    }

    // remove the previously compiled clients (the folder also holds the placeholder)
    for (const file of await fs.readdir(compilePath)) {
        if (file === WEB_DIR || file === DESKTOP_DIR || path.extname(file).toLowerCase() === ".zip") {
            await fs.rm(path.join(compilePath, file), {"recursive": true, "force": true});
        }
    }
    await fs.mkdir(desktopDestPath, {"recursive": true});

    // read available native libs
    const nativePath = path.join(serverScriptPath, "client", "native");
    const nativeLibs = await fs.readdir(nativePath);

    // read binary dists (filter with native libs)
    const dists = [];
    const roots = await fs.readdir(sourcePath);
    for (const root of roots) {
        const rootPath = path.join(sourcePath, root);
        const rootInfo = path.basename(rootPath, path.extname(rootPath)).split("-");
        const rootStat = await fs.stat(rootPath);
        const isZip = rootStat.isFile() && path.extname(rootPath).toLowerCase() === ".zip";
        if (rootStat.isDirectory() === false && isZip === false) {
            continue;
        }
        if (rootInfo.length !== 2 || nativeLibs.includes(rootInfo[0] + "-" + rootInfo[1]) === false) {
            continue;
        }
        dists.push({
            "path": rootPath,
            "os": rootInfo[0],
            "arch": rootInfo[1],
            "isZip": isZip
        });
    }

    // generate conf file, the same one every dist and the web client is given
    const confFile = await buildConfFile(conf, dists);

    // minify the shared client parts once, they go into every dist
    process.stdout.write("\n    Building web client...    ");
    const webPath = path.join(serverScriptPath, "client", "web");
    const electronPath = path.join(serverScriptPath, "client", "electron");
    const webFiles = await buildFolder(webPath, true, GENERATED_FILES);
    const electronFiles = await buildFolder(electronPath, false);
    await writeWeb(webDestPath, webFiles, confFile);
    process.stdout.write("done");

    if (dists.length === 0) {
        process.stdout.write("\n");
        console.error("No electron dist found in: " + sourcePath);
        return true;    // the web client is built, only the desktop ones are missing
    }

    // go through the dists
    for (const dist of dists) {
        const target = dist["os"] + "-" + dist["arch"];
        process.stdout.write("\n    Compiling " + target + "...    ");

        // the electron dist is the base of the destination zip
        const entries = await packDist(dist);

        // go select destination to common parts
        let commonDest = path.join("resources", "app");
        if (dist["os"] === "darwin") {
            commonDest = path.join("Electron.app", "Contents", "Resources", "app");
        }

        // copy the built web and electron files
        for (const file of [...webFiles, ...electronFiles]) {
            entries.push({"name": zipPath(commonDest, file["path"]), "data": file["data"]});
        }

        // copy native lib files, read one by one while they are deflated
        const nativeLibPath = path.join(nativePath, target);
        const nativeLibFiles = await fs.readdir(nativeLibPath, {"recursive": true});
        for (const file of nativeLibFiles) {
            const filePath = path.join(nativeLibPath, file);
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
                entries.push({"name": zipPath(commonDest, file) + "/", "isDir": true, "mode": stat.mode, "date": stat.mtime});
            } else {
                entries.push({"name": zipPath(commonDest, file), "path": filePath, "mode": stat.mode, "date": stat.mtime});
            }
        }

        // add conf file
        entries.push({"name": zipPath(commonDest, CONF_FILE), "data": Buffer.from(confFile, "utf8")});

        // save the zip file
        try {
            await writeDistZip(path.join(desktopDestPath, target + ".zip"), entries);
        } catch (error) {
            process.stdout.write("error (" + error.message + ")");
            continue;
        }
        process.stdout.write("done");
    }
    process.stdout.write("\n");
    return true;
};

export { compileClients, minifyScript, minifyStyle, minifyMarkup };
export default { compileClients, minifyScript, minifyStyle, minifyMarkup };
