"use strict";

// comlile the desktop clients
const compileClients = async function(conf) {

    // secure in/out folders
    const sourcePath = path.join("./bin");
    const compilePath = path.join("./tmp");
    try {
        await fs.access(sourcePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
        // create compile path if not exists
        try {
            await fs.mkdir(sourcePath, { "recursive": true });
        } catch (error) {
            throw new Error("Cannot create source path: " + sourcePath + " - " + error.message);
        }
    }
    try {
        await fs.access(compilePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
        // create compile path if not exists
        try {
            await fs.mkdir(compilePath, { "recursive": true });
        } catch (error) {
            throw new Error("Cannot create compile path: " + compilePath + " - " + error.message);
        }
    }

    // exit if compile is not requested and already compiled
    let isCompiled = await isDirEmpty(compilePath);
    if (conf["flags"]["compile"] === false && isCompiled) {
        return false;
    }

    //remove old compiled files
    for (const file of await fs.readdir(compilePath)) {
        await fs.rm(path.join(compilePath, file), { "recursive": true, "force": true });
    }

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
        if (rootStat.isDirectory() && rootInfo.length === 2 && nativeLibs.includes(rootInfo[0] + "-" + rootInfo[1])) {
            dists.push({
                "path": rootPath,
                "os": rootInfo[0],
                "arch": rootInfo[1],
                "isZip": false
            });
        } else if (rootStat.isFile() && path.extname(rootPath) === ".zip" && rootInfo.length === 2 && nativeLibs.includes(rootInfo[0] + "-" + rootInfo[1])) {
            dists.push({
                "path": rootPath,
                "os": rootInfo[0],
                "arch": rootInfo[1],
                "isZip": true
            });
        }
    }
    if (dists.length === 0) {
        console.error("No electron dist found in: " + sourcePath);
        return false;
    }

    // generate conf script
    const confData = {
        "ws": {}
    };
    if (typeof conf["http"] === "object") {
        confData["http"] = {};
        confData["http"]["domain"] = conf["http"]["domain"];
        confData["http"]["port"] = conf["http"]["port"];
        confData["http"]["version"] = CLIENT_VERSION;
    }
    if (typeof conf["http"]["remote"] === "object") {
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
    let confScript = "\"use strict\";";
    confScript += "\n" + "export default " + JSON.stringify(confData) + ";";

    // read web files
    const webPath = path.join(serverScriptPath, "client", "web");
    const webFiles = await fs.readdir(webPath, {"recursive": true});
    const electronPath = path.join(serverScriptPath, "client", "electron");
    const electronFiles = await fs.readdir(electronPath, {"recursive": true});

    // go through the dists
    for (const dist of dists) {
        process.stdout.write("\n    Compiling " + dist["os"] + "-" + dist["arch"] + "...    ");

        // create destination zip
        const zip = new JSZip();

        // go through source dist files
        if (dist["isZip"] === true) {
            const zipData = await fs.readFile(dist["path"]);
            const distZip = await JSZip.loadAsync(zipData);
            const files = distZip.files;
            
            // delete asar default app file
            let deleteFile = "resources/default_app.asar";
            if (dist["os"] === "darwin") {
                deleteFile = "Electron.app/Contents/Resources/default_app.asar";
            }
            if (typeof files[deleteFile] !== "undefined") {
                delete files[deleteFile];
            }

            console.log(files);
            
            for (let file in distZip.files) {
                const fileContents =  await distZip.files[file].async("arraybuffer");
                zip.file(file, fileContents);
            }
        } else {
            const files = await fs.readdir(dist["path"], {"recursive": true});

            // delete asar default app file
            let deleteFile = path.join("resources", "default_app.asar")
            if (dist["os"] === "darwin") {
                deleteFile = path.join("Electron.app", "Contents", "Resources", "default_app.asar");
            }
            const asarIndex = files.splice(files.indexOf(deleteFile), 1);
            if (asarIndex !== -1) {
                files.splice(asarIndex, 1);
            }

            for (const file of files) {
                const filePath = path.join(dist["path"], file);
                const isDir = (await fs.stat(filePath)).isDirectory();
                if (isDir) {
                    zip.folder(file);
                } else {
                    const fileContents = await fs.readFile(filePath);
                    zip.file(file, fileContents);
                }
            }
        }
        
        // go select destination to common parts
        let commonDest = path.join("resources", "app");
        if (dist["os"] === "darwin") {
            commonDest = path.join("Electron.app", "Contents", "Resources", "app");
        }

        //copy web files
        for (const file of webFiles) {
            const filePath = path.join(webPath, file);
            const isDir = (await fs.stat(filePath)).isDirectory();
            if (isDir) {
                zip.folder(path.join(commonDest, file));
            } else {
                const fileContents = await fs.readFile(filePath);
                zip.file(path.join(commonDest, file), fileContents);
            }
        }

        // copy electron files
        for (const file of electronFiles) {
            const filePath = path.join(electronPath, file);
            const isDir = (await fs.stat(filePath)).isDirectory();
            if (isDir) {
                zip.folder(path.join(commonDest, file));
            } else {
                const fileContents = await fs.readFile(filePath);
                zip.file(path.join(commonDest, file), fileContents);
            }
        }

        // copy native lib files
        const nativeLibPath = path.join(nativePath, dist["os"] + "-" + dist["arch"]);
        const nativeLibFiles = await fs.readdir(nativeLibPath, {"recursive": true});
        for (const file of nativeLibFiles) {
            const filePath = path.join(nativeLibPath, file);
            const isDir = (await fs.stat(filePath)).isDirectory();
            if (isDir) {
                zip.folder(path.join(commonDest, file));
            } else {
                const fileContents = await fs.readFile(filePath);
                zip.file(path.join(commonDest, file), fileContents);
            }
        }

        // add conf file
        zip.file(path.join(commonDest, "conf.js"), confScript);

        // save the zip file
        const buff = await zip.generateAsync({"type" : "uint8array"});
        const zipFileName =  dist["os"] + "-" + dist["arch"] + ".zip";
        const zipFilePath = path.join(compilePath, zipFileName);
        try {
            await fs.writeFile(zipFilePath, buff);
        } catch (error) {
            process.stdout.write("error\n");
            continue;
        }
        process.stdout.write("done");
    }
    process.stdout.write("\n");
    return true;
    
};