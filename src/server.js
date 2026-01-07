"use strict";

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";

// third-party dependenciess
import JSZip from "jszip";
import { WebSocketServer } from "ws";
import knex from "knex";
import nodemailer from "nodemailer";

// first-party dependencies
import Mime from "easy-mime";
import Communicator from "easy-communicator";
import { stat } from "node:fs";

const CLIENT_VERSION = "0.1.0";
const MIN_CLIENT_VERSION = CLIENT_VERSION;

//
// Helper functions
//

// generate random ID
const generateId = function(length=10, chars="1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
    let id = "";
    for (let i = 0; i < length; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
};

// binary search in array [isFound, index]
const binarySearch = function(arr, x, getVal=function(el) {return el}) {   
    let start = 0;
    let end = arr.length - 1;
    let mid;
    while (start <= end) {
        mid = Math.floor((start + end) / 2);
        const val = getVal(arr[mid]);
        if (val === x) {
        	return [true, mid];
        }
  
        if (val < x) {
            start = mid + 1;
        } else {
            end = mid - 1;
        }
    }
    return [false, start];
};

// search in parameters
const getArg = function(args, argName, isKeyValue=false, isInline=false) {
    for (let i = 0, length=args.length; i < length; i++) {
        const arg = args[i];
        if (isKeyValue) {
            if (isInline) {
                if (arg.startsWith(argName + "=")) {
                    return arg.slice(argName.length + 1);
                }
            } else {
                if (arg === argName) {
                    return args[i + 1];
                }
            }
        } else {
            if (arg === argName) {
                return true;
            }
        }
    }
    return undefined;
};

// check if dir is empty
const isDirEmpty = async function(dirPath) {
    try {
        const dirIter = await fs.opendir(dirPath);
        const {value, done} = await dirIter[Symbol.asyncIterator]().next();
        if (!done) {
            await dirIter.close();
            return true;
        }
        return false;
    } catch (error) {
        return undefined;
    }
};

// this will join path if relative
const setAbsolute = function(src, origin) {
    if (path.isAbsolute(src) === false) {
        src = path.join(origin, src);
    }
    return path.resolve(src);
};

// language texts
const dict = {
    "delete": {
        "0": {
            "en": "Your delete code is for account (",
            "hu": "A törlőkódod: "
        },
        "1": {
            "en": "). Please use the following code to confirm account deletion:",
            "hu": "). Kérlek, használd a következő kódot a fiók törlésének megerősítéséhez:"
        },
        "2": {
            "en": " If you did not request account deletion, please ignore this email.",
            "hu": " Ha nem kérted a fiókod törlését, kérlek, hagyd figyelmen kívül ezt az e-mailt."
        }
    }
};

const getText = (key, lang) => {
    let current = dict;
    const original = key;
    try {
        key = key.split(".");
        for (let i = 0; i < key.length; i++) {
            current = current[key[i]];
        }
        return current[lang];
    } catch (e) {
        console.warn(`Localization key "${original}" not found!`);
        return "";
    }
    
};


//
// Logic
//
const serverScriptPath = import.meta.dirname;

// proceed the conf file fields
const processConf = async function(confPath) {
    //console.log(confPath);

    // load conf file (required)
    const contents = await fs.readFile(confPath, {
        "encoding": "utf8"
    });
    let confIn = {};
    let confOut = {};
    try {
        confIn = JSON.parse(contents);
        if (typeof confIn !== "object") {
            throw new Error("Invalid JSON format!");
        }
    } catch (error) {
        throw new Error("Invalid configuration file: " + error.message);
    }
    

    // check HTTP settings
    const http = confIn["http"];
    if (typeof http === "object") {
        confOut["http"] = {};
        const httpOut = confOut["http"];

        // check domain
        const domain = http["domain"];
        if (typeof domain !== "string" || domain.length === 0) {
            throw new Error("Invalid HTTP domain: " + domain);
        }
        httpOut["domain"] = domain;

        // check port
        const port = http["port"];
        if (typeof port !== "number" || port < 1 || port > 65535) {
            throw new Error("Invalid HTTP port: " + port);
        }
        httpOut["port"] = port;

        // check key
        const key = http["key"];
        if (typeof key !== "string") {
            throw new Error("Invalid HTTP key path: " + key);
        }
        try {
            const keyPath = setAbsolute(key, path.dirname(confPath));
            httpOut["key"] = await fs.readFile(keyPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid HTTP key path: " + http["key"] + " - " + error.message);
        }

        // check cert
        const cert = http["cert"];
        if (typeof cert !== "string") {
            throw new Error("Invalid HTTP cert path: " + cert);
        }
        try {
            const certPath = setAbsolute(cert, path.dirname(confPath));
            httpOut["cert"] = await fs.readFile(certPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid HTTP cert path: " + cert + " - " + error.message);
        }

        // check redirect (optional)
        const redirect = http["redirect"];
        if (typeof redirect === "number") {
            if (redirect < 1 || redirect > 65535 || redirect === http["port"]) {
                throw new Error("Invalid HTTP redirect port: " + redirect);
            }
            httpOut["redirect"] = redirect;
        }

        // check cache (optional)
        const cache = http["cache"];
        if (typeof cache === "object") {
            httpOut["cache"] = {};
            const httpCacheOut = httpOut["cache"];
            // check size
            const size = cache["size"];
            if (typeof size !== "number" || size < 0) {
                throw new Error("Invalid HTTP cache size: " + size);
            }
            httpCacheOut["size"] = size;
            // check sizeLimit
            const sizeLimit = cache["sizeLimit"];
            if (typeof sizeLimit !== "number" || sizeLimit < 0) {
                throw new Error("Invalid HTTP cache sizeLimit: " + sizeLimit);
            }
            if (sizeLimit > cache["size"]) {
                throw new Error("HTTP cache sizeLimit cannot be greater than cache size!");
            }
            httpCacheOut["sizeLimit"] = sizeLimit;
        }

        // check remote (optional)
        const remote = http["remote"];
        if (typeof remote === "object") {
            httpOut["remote"] = {};
            // check host
            const host = remote["host"];
            if (typeof host !== "string" || host.length === 0) {
                throw new Error("Invalid HTTP remote host: " + host);
            }
            httpOut["remote"]["host"] = host;

            // check port
            if (typeof http["remote"]["port"] !== "number" || http["remote"]["port"] < 1 || http["remote"]["port"] > 65535) {
                throw new Error("Invalid HTTP remote port: " + http["remote"]["port"]);
            }
            httpOut["remote"]["port"] = http["remote"]["port"];
        }
    }


    // check WS settings
    const ws = confIn["ws"];
    if (typeof ws === "object") {
        confOut["ws"] = {};
        const wsOut = confOut["ws"];

        // check domain
        const domain = ws["domain"];
        if (typeof http !== "object" && (typeof domain !== "string" || domain.length === 0)) {
            throw new Error("Need WS domain if HTTP domain not specified: " + domain);
        }
        wsOut["domain"] = domain;

        // check port
        const port = ws["port"];
        if (typeof port !== "number" || port < 1 || port > 65535) {
            throw new Error("Invalid WS port: " + port);
        }
        if (port === confOut?.["http"]?.["redirect"]) {
            throw new Error("WS port cannot be the same as HTTP redirect port!");
        }
        wsOut["port"] = port;

        // check key
        const key = ws["key"];
        if (typeof key !== "string") {
            throw new Error("Invalid WS key path: " + key);
        }
        try {
            const keyPath = setAbsolute(key, path.dirname(confPath));
            wsOut["key"] = await fs.readFile(keyPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid WS key path: " + key + " - " + error.message);
        }

        // check cert
        const cert = ws["cert"];
        if (typeof cert !== "string") {
            throw new Error("Invalid WS cert path: " + cert);
        }
        try {
            const certPath = setAbsolute(cert, path.dirname(confPath));
            wsOut["cert"] = await fs.readFile(certPath, {
                "encoding": "utf8"
            });
        } catch (error) {
            throw new Error("Invalid WS cert path: " + confIn["ws"]["cert"] + " - " + error.message);
        }

        // check database
        const database = ws["database"];
        if (typeof database !== "object") {
            throw new Error("Invalid WS Database configuration: " + database);
        } else {
            wsOut["database"] = {};
            const databaseOut = wsOut["database"];

            // check Database type
            const type = database["type"];
            if (typeof type !== "string" || ["mysql"].includes(type) === false) {
                throw new Error("Invalid WS Database type: " + type);
            }
            databaseOut["type"] = type;

            // check Database host
            const host = database["host"];
            if (typeof host !== "string" || host.length === 0) {
                throw new Error("Invalid WS Database host: " + host);
            }
            databaseOut["host"] = host;

            // check Database port
            const port = database["port"];
            if (typeof port !== "number" || port < 1 || port > 65535) {
                throw new Error("Invalid WS Database port: " + port);
            }
            databaseOut["port"] = port;

            // check Database user
            const user = database["user"];
            if (typeof user !== "string") {
                throw new Error("Invalid WS Database user: " + user);
            }
            databaseOut["user"] = user;

            // check Database password
            const pass = database["pass"];
            if (typeof pass !== "string") {
                throw new Error("Invalid WS Database password: " + pass);
            }
            databaseOut["pass"] = pass;

            // check Database database
            const db = database["db"];
            if (typeof db !== "string") {
                throw new Error("Invalid WS Database name: " + db);
            }
            databaseOut["db"] = db;

        };
        
        // check emails
        const emails = ws["emails"];
        if (typeof emails !== "object" || emails instanceof Array === false || emails.length === 0) {
            throw new Error("Invalid WS SMTP configuration: " + emails);
        } else {
            wsOut["emails"] = [];
            const emailsOut = wsOut["emails"];

            // check each email 
            for (const email of emails) {
                if (typeof email !== "object") {
                    throw new Error("Invalid WS SMTP configuration: " + email);
                }
                const emailOut = {};

                // check SMTP host
                const host = email["host"];
                if (typeof host !== "string" || host.length === 0) {
                    throw new Error("Invalid WS SMTP host: " + host);
                }
                emailOut["host"] = host;

                // check SMTP port
                const port = email["port"];
                if (typeof port !== "number" || port < 1 || port > 65535) {
                    throw new Error("Invalid WS SMTP port: " + port);
                }
                emailOut["port"] = port;

                // check SMTP user
                const user = email["user"];
                if (typeof user !== "string") {
                    throw new Error("Invalid WS SMTP user: " + user);
                }
                emailOut["user"] = user;

                // check send limit per hour
                const limit = email["limit"];
                if (typeof limit !== "number" || limit < 1) {
                    throw new Error("Invalid WS SMTP limitPerHour: " + limit);
                }
                emailOut["limit"] = limit;

                // check authentication
                const auth = email["auth"];
                if (typeof auth !== "object") {
                    throw new Error("Invalid WS SMTP auth configuration: " + auth);
                } else {
                    emailOut["auth"] = {};
                    const authOut = emailOut["auth"];

                    // check auth type
                    const type = auth["type"];
                    if (type === "password") {
                        // check password
                        const pass = auth["pass"];
                        if (typeof pass !== "string") {
                            throw new Error("Invalid WS SMTP auth password: " + pass);
                        }
                        authOut["pass"] = pass;

                    } else if (type === "OAuth2") {
                        // check clientId
                        const clientId = auth["clientId"];
                        if (typeof clientId !== "string" || clientId.length === 0) {
                            throw new Error("Invalid WS SMTP auth clientId: " + clientId);
                        }
                        authOut["clientId"] = clientId;

                        // check clientSecret
                        const clientSecret = auth["clientSecret"];
                        if (typeof clientSecret !== "string" || clientSecret.length === 0) {
                            throw new Error("Invalid WS SMTP auth clientSecret: " + clientSecret);
                        }
                        authOut["clientSecret"] = clientSecret;

                        // check refreshToken
                        const refreshToken = auth["refreshToken"];
                        if (typeof refreshToken !== "string" || refreshToken.length === 0) {
                            throw new Error("Invalid WS SMTP auth refreshToken: " + refreshToken);
                        }
                        authOut["refreshToken"] = refreshToken;
                    } else {
                        throw new Error("Invalid WS SMTP auth type: " + smtp["auth"]["type"]);
                    }
                    authOut["type"] = type;
                }

                emailsOut.push(emailOut);
            }
        }

        // check webrtc
        const webrtc = ws["webrtc"];
        if (typeof webrtc !== "object") {
            throw new Error("Invalid WS WebRTC configuration: " + webrtc);
        } else {
            wsOut["webrtc"] = {};
            const webrtcOut = wsOut["webrtc"];
            const iceServers = webrtc["iceServers"];
            if (typeof iceServers !== "object" || iceServers instanceof Array === false || iceServers.length === 0) {
                throw new Error("Invalid WS WebRTC iceServers configuration: " + iceServers);
            } else {
                webrtcOut["iceServers"] = [];
                const iceServersOut = webrtcOut["iceServers"];
                for (const iceServer of iceServers) {
                    iceServersOut.push(iceServer);
                    if (typeof iceServer !== "string" || iceServer.length === 0) {
                        throw new Error("Invalid WS WebRTC iceServer: " + iceServer);
                    }
                }
            }
        }
        

        // check features
        const features = ws["features"];
        if (typeof features !== "object") {
            throw new Error("Invalid WS features configuration: " + features);
        } else {
            wsOut["features"] = {};
            const featuresOut = wsOut["features"];

            // check auth
            const auth = features["auth"];
            if (typeof auth !== "object") {
                throw new Error("Invalid WS features auth configuration: " + auth);
            } else {
                featuresOut["auth"] = {};
                const authOut = featuresOut["auth"];

                // check local auth
                const local = auth["local"];
                if (typeof local === "object") {
                    throw new Error("Password authentication is not implemented yet!");
                    authOut["local"] = {};
                    const localOut = authOut["local"];     
                    
                    // check allowPasswordLogin
                    const allowPasswordLogin = local["allowPasswordLogin"];
                    if (typeof allowPasswordLogin !== "boolean") {
                        throw new Error("Invalid WS features auth local allowPasswordLogin: " + allowPasswordLogin);
                    }
                    localOut["allowPasswordLogin"] = allowPasswordLogin;

                    // check allowCodeLogin
                    const allowCodeLogin = local["allowCodeLogin"];
                    if (typeof allowCodeLogin !== "boolean") {
                        throw new Error("Invalid WS features auth local allowCodeLogin: " + allowCodeLogin);
                    }
                    localOut["allowCodeLogin"] = allowCodeLogin;

                    // check allowRegister
                    const allowRegister = local["allowRegister"];
                    if (typeof allowRegister !== "boolean") {
                        throw new Error("Invalid WS features auth local allowRegister: " + allowRegister);
                    }
                    localOut["allowRegister"] = allowRegister;

                }

                // check google auth
                const google = auth["google"];
                if (typeof google === "object") {
                    authOut["google"] = {};
                    const googleOut = authOut["google"];

                    // check clientId
                    const clientId = google["clientId"];
                    if (typeof clientId !== "string" || clientId.length === 0) {
                        throw new Error("Invalid WS features auth google clientId: " + clientId);
                    }
                    googleOut["clientId"] = clientId;

                    // check clientSecret
                    const clientSecret = google["clientSecret"];
                    if (typeof clientSecret !== "string" || clientSecret.length === 0) {
                        throw new Error("Invalid WS features auth google clientSecret: " + clientSecret);
                    }
                    googleOut["clientSecret"] = clientSecret;
                }

                if (Object.keys(authOut).length === 0) {
                    throw new Error("At least one WS features auth method must be configured!");
                }
            }

            // check screenSharing
            const screenSharing = features["screenSharing"];
            if (typeof screenSharing === "object") {
                featuresOut["screenSharing"] = {};
                const screenSharingOut = featuresOut["screenSharing"];

                // check isHomePage (optional, default false)
                const isHomePage = screenSharing["isHomePage"];
                if (typeof isHomePage !== "undefined") {
                    if (typeof isHomePage !== "boolean") {
                        throw new Error("Invalid WS features screenSharing isHomePage: " + isHomePage);
                    } else {
                        screenSharingOut["isHomePage"] = isHomePage;
                    }
                } else {
                    screenSharingOut["isHomePage"] = false;
                }

                // check allowGuestShare
                const allowGuestShare = screenSharing["allowGuestShare"];
                if (typeof allowGuestShare !== "undefined" && typeof allowGuestShare !== "boolean") {
                    throw new Error("Invalid WS features screenSharing isHomePage: " + isHomePage);
                } else {
                    screenSharingOut["allowGuestShare"] = allowGuestShare;
                }

                // check allowGuestJoin
                const allowGuestJoin = screenSharing["allowGuestJoin"];
                if (typeof allowGuestJoin !== "undefined" && typeof allowGuestJoin !== "boolean") {
                    throw new Error("Invalid WS features screenSharing isHomePage: " + isHomePage);
                } else {
                    screenSharingOut["allowGuestJoin"] = allowGuestJoin;
                }
            }

            // check serviceSharing
            const serviceSharing = features["serviceSharing"];
            if (typeof serviceSharing === "object") {
                featuresOut["serviceSharing"] = {};
                const serviceSharingOut = featuresOut["serviceSharing"];

                // check isHomePage (optional, default false)
                const isHomePage = serviceSharingOut["isHomePage"];
                if (typeof isHomePage !== "undefined") {
                    if (typeof isHomePage !== "boolean") {
                        throw new Error("Invalid WS features screenSharing isHomePage: " + isHomePage);
                    } else {
                        serviceSharingOut["isHomePage"] = isHomePage;
                    }
                } else {
                    serviceSharingOut["isHomePage"] = false;
                }

                if (serviceSharingOut["isHomePage"] === true && featuresOut["screenSharing"]["isHomePage"] === true) {
                    throw new Error("WS features screenSharing and serviceSharing cannot both be home page!");
                }
            }
        }

    }


    // check HTTP and WS constraints
    if (typeof confOut["http"] !== "object" && typeof confOut["ws"] !== "object") {
        throw new Error("At least one of HTTP or WS configuration must be provided!");
    }
    if (typeof confOut["http"] === "object" && typeof confOut["http"]["remote"] !== "object" && typeof confOut["ws"] !== "object") {
        throw new Error("HTTP remote configuration must be provided if no local WS server in configuration!");
    }
    if (typeof confOut["ws"] === "object" && typeof confOut["http"]["remote"] === "object") {
        throw new Error("WS server cannot be created if HTTP remote is configured!");
    }

    return confOut;
};

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

// create HTTP/WS servers
const Server = class {
    httpBasePath = "./src/client/web";
    httpDownloadPath = "./tmp";
    httpServer = null;
    httpCache = new Map();
    httpCacheSize = 0;
    httpCacheSizeLimit = 0;
    httpCacheUpdate = 1000;
    httpCacheUpdateLength = 5;
    httpCacheUpdateId = -1;
    httpCacheReloadId = -1;
    httpRedirect = null;

    wsServer = null;
    wsHttpServer = null;
    mailers = [];
    clientConf = {};
    authGoogle = null;
    domain = "";

    // clients map
    clients = new Map();            // key-clientId, value-state object of the client
    sessions = new Map();           // key-sessionId, value-set of clientIds
    subscriptions = new Map([
        ["email", new Map()],
        ["firstName", new Map()],
        ["lastName", new Map()],
        ["picture", new Map()],
        ["sessions", new Map()]
    ]);      // key-subscription name, value-> Map of "userId" -> Set of "clientId"

    isClosing = false;
    constructor() {

    };

    async getFileData(src) {
        try {
            const data = await fs.readFile(src);
            const stats = await fs.stat(src);
            const date = new Date(stats.mtimeMs);
            return {
                "lastModified": date.toUTCString(),
                "type": Mime.getMIMEType(path.extname(src)) || "text/plain",
                "size": stats.size,
                "etag": path.basename(src) + String(stats.size),
                "buffer": data
            };
        } catch (error) {
            return undefined;
        }
        
    };
    async getFileDataStream(src) {
        try {
            const stats = await fs.stat(src);
            if (stats.isFile() === false) {
                return undefined;
            }

            const data = await fs.open(src);
            const date = new Date(stats.mtimeMs);
            const stream = data.createReadStream();

            //close if end or inactive
            let timeOut = -1;
            stream.on("data", function() {
                //console.log("read");
                clearTimeout(timeOut);
                timeOut = setTimeout(function() {
                    data?.close?.();
                }, 10000);
            });
            stream.on("end", function() {
                //console.log("end");
                clearTimeout(timeOut);
                data?.close?.();
            });
            
            return {
                "lastModified": date.toUTCString(),
                "type": Mime.getMIMEType(path.extname(src)) || "text/plain",
                "size": stats.size,
                "etag": path.basename(src) + String(stats.size),
                "stream": stream
            };
        } catch (error) {
            return undefined;
        }
    };

    async httpsGetText(url) {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                const statusCode = res.statusCode;

                if (statusCode !== 200) {
                    const error = new Error("Request Failed.\n" + `Status Code: ${statusCode}`);
                    //console.error(error.message);
                    // Consume response data to free up memory
                    res.resume();
                    reject(error);
                    return;
                }

                let rawData = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => {
                    rawData += chunk;
                });
                res.on("end", () => {
                    resolve(rawData);
                });
            }).on("error", (error) => {
                console.error(`Got error: ${error.message}`);
                reject(error);
            });
        });
    };
    async httpsGetImage(url) {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                const statusCode = res.statusCode;
                const contentType = res.headers["content-type"];

                if (statusCode !== 200) {
                    const error = new Error("Request Failed.\n" + `Status Code: ${statusCode}`);
                    //console.error(error.message);
                    // Consume response data to free up memory
                    res.resume();
                    reject(error);
                    return;
                }

                let rawData = "";
                res.setEncoding("base64");
                res.on("data", (chunk) => {
                    rawData += chunk;
                });
                res.on("end", () => {
                    const data = "data:" + contentType + ";base64," + rawData;
                    resolve(data);
                });
            }).on("error", (error) => {
                console.error(`Got error: ${error.message}`);
                reject(error);
            });
        });
    };

    async start(conf) {
        process.stdout.write("Starting HTTP server...    ");
        // Start HTTP server
        if (typeof conf["http"] === "object") {
            const basePaths = [this.httpBasePath, this.httpDownloadPath];

            // create configuration file
            const files = await fs.readdir(this.httpDownloadPath);
            const confData = {
                "http": {
                    "clients": [...files],
                    "version": CLIENT_VERSION
                },
                "ws": {}
            };
            if (typeof conf["http"]["remote"] === "object") {
                confData["ws"]["domain"] = conf["http"]["remote"]["host"];
                confData["ws"]["port"] = conf["http"]["remote"]["port"];
            } else {
                confData["ws"]["domain"] = conf["http"]["domain"];
                confData["ws"]["port"] = conf["ws"]["port"];
            }
            let confScript = "\"use strict\";";
            confScript += "\n" + "export default " + JSON.stringify(confData) + ";";
            await fs.writeFile(path.join(this.httpBasePath, "conf.js"), confScript);
            await fs.writeFile(path.join(this.httpBasePath, "version"), CLIENT_VERSION);

            // create HTTP server request handler
            let requestHandle = null;
            if (typeof conf["http"]["cache"] !== "object") {
                requestHandle = async (req, res) => {
                    const filePath = req.url.slice(1);          // remove start slash

                    // get requested file
                    let fileData;
                    for (const basePath of basePaths) {
                        const fullPath = path.join(basePath, filePath);
                        fileData = await this.getFileDataStream(fullPath); 
                        if (typeof fileData !== "undefined") {
                            break; // found
                        }
                    }
                    // get default file if not found
                    if (typeof fileData === "undefined") {
                        fileData = await this.getFileDataStream(path.join(basePaths[0], "index.html")); 
                    }
                    res.writeHead(200, {
                        //"Content-Security-Policy": "connect-src https://accounts.google.com/gsi/",
                        "Cache-Control": "no-cache, no-store, must-revalidate",
                        "Last-Modified": fileData["lastModified"],
                        "Content-Length": fileData["size"],
                        "Content-Type": fileData["type"],
                        "ETag": fileData["etag"]
                    });
                    fileData["stream"].pipe(res);
                };
            } else {
                // build cache
                this.httpCache = new Map();
                for (const basePath of basePaths.reverse()) {
                    const files = await fs.readdir(basePath, {"recursive": true});
                    for (const file of files) {
                        const src = path.join(basePath, file);
                        const stats = await fs.stat(src);
                        const date = new Date(stats.mtimeMs);
                        this.httpCache.set(file, {
                            "path": src,
                            "lastModified": date.toUTCString(),
                            "type": Mime.getMIMEType(path.extname(src)),
                            "size": stats.size,
                            "etag": path.basename(src) + String(stats.size),
                            "accesses": new Array(this.httpCacheUpdateLength*2).fill(0),
                            "accessed": 0,
                        });
                    }
                }

                // update access stats periodically
                this.httpCacheSize = conf["http"]["cache"]["size"];
                clearInterval(this.httpCacheUpdateId);
                this.httpCacheUpdateId = setInterval(() => {
                    const it = this.httpCache.entries();
                    for (const [key, fileData] of it) {
                        fileData["accessed"] -= fileData["accesses"].pop();
                        fileData["accesses"].unshift(0);
                    }
                }, this.httpCacheUpdate);

                // reload cache periodically
                clearInterval(this.httpCacheReloadId);
                this.httpCacheReloadId = setInterval(async () => {
                    // fill with priority order small -> high (smaller is better)
                    const priorityOrder = [];
                    const it = this.httpCache.entries();
                    for (const [key, val] of it) {
                        if (typeof val["size"] > this.httpCacheSizeLimit) {
                            continue; // skip too big files
                        }
                        const el = {
                            "file": key,
                            "priority": -(val["accessed"] / Math.max(val["size"], 1))
                        };
                        const [isFound, i] = binarySearch(priorityOrder, el["priority"], function(el) {return el["priority"]});
                        priorityOrder.splice(i, 0, el);
                    }

                    // search for last cached file
                    const length = priorityOrder.length;
                    let currentSize = 0;
                    let currentIndex = 0;
                    while (currentIndex < length && currentSize < this.httpCacheSize && priorityOrder[currentIndex]["priority"] < 0) {
                        currentSize += this.httpCache.get(priorityOrder[currentIndex]["file"])["size"];
                        currentIndex++;
                    }
                    //console.log(currentSize);
                    //console.log(currentIndex);
                    
                    // remove unused files
                    for (let i = currentIndex; i < length; i++) {
                        const fileData = this.httpCache.get(priorityOrder[i]["file"]);
                        delete fileData["buffer"]; // remove buffer to save memory
                    }

                    // add files to cache
                    for (let i = 0; i < currentIndex; i++) {
                        const fileData = this.httpCache.get(priorityOrder[i]["file"]);
                        if (typeof fileData["buffer"] === "undefined") {
                            fileData["buffer"] = (await this.getFileData(fileData["path"]))["buffer"];
                        }
                    }

                    //console.log(priorityOrder);
                    //console.log(this.httpCache.get("index.html"));
                }, this.httpCacheUpdate * this.httpCacheUpdateLength);

                requestHandle = async (req, res) => {
                    let filePath = req.url.slice(1);          // remove start slash

                    // check existence of file
                    let fileData = this.httpCache.get(filePath);
                    if (typeof fileData === "undefined") {
                        fileData = this.httpCache.get("index.html");
                    }

                    // add access to statistics
                    fileData["accesses"][0] += 1;
                    fileData["accessed"] += 1;

                    // check if file is in memory cache
                    res.writeHead(200, {
                        //"Content-Security-Policy": "default-src 'self'",
                        "Last-Modified": fileData["lastModified"],
                        "Content-Length": fileData["size"],
                        "Content-Type": fileData["type"]
                    });
                    if (typeof fileData["buffer"] !== "undefined") {
                        res.write(fileData["buffer"]);
                        res.end();
                    } else {
                        const file = await this.getFileDataStream(fileData["path"]);
                       file["stream"].pipe(res);
                    }
                };
            }
            this.httpServer = https.createServer({
                "key": conf["http"]["key"],
                "cert": conf["http"]["cert"]
            }, requestHandle);
            this.httpServer.listen(conf["http"]["port"]);
            process.stdout.write("\n    Available: https://" + conf["http"]["domain"] + (conf["http"]["port"] !== 443 ? ":" + conf["http"]["port"] : "") + "\n");

            // create redirect server
            if (typeof conf["http"]["redirect"] !== "undefined") {
                const redirectHandle = function(req, res) {
                    const myURL = req.headers.host.split(":")[0];
                    const myPort = conf["http"]["port"] !== 443 ? ":" + conf["http"]["port"] : "";
                    res.writeHead(302, {
                        "Location": "https://" + myURL + myPort + req.url
                    });
                    res.end();
                };
                this.httpRedirect = http.createServer(redirectHandle);
                this.httpRedirect.listen(conf["http"]["redirect"]);
                process.stdout.write("    Redirect: http://" + conf["http"]["domain"] + (conf["http"]["redirect"] !== 80 ? ":" + conf["http"]["port"] : "") + "\n");
            }
            process.stdout.write("done\n");

        } else {
            process.stdout.write("skipped\n");
        }

        // Start WebSocket server
        process.stdout.write("Starting WS server...    ");
        if (typeof conf["ws"] === "object") {
            // copy domain data
            if (typeof conf["http"]["domain"] === "string") {
                this.domain = conf["http"]["domain"];
            } else {
                this.domain = conf["ws"]["domain"];
            }

            // Connect to mail servers
            for (const smtp of conf["ws"]["emails"]) {
                if (smtp["auth"]["type"] === "password") {
                    const transporter = nodemailer.createTransport({
                        "host": smtp["host"],
                        "port": smtp["port"],
                        "secure": true,
                        "auth": {
                            "user": smtp["user"],
                            "pass": smtp["auth"]["pass"]
                        }
                    });
                    const res = await transporter.verify();
                    if (res === false) {
                        throw new Error("Cannot authenticate WS SMTP with provided configuration: " + JSON.stringify(smtp));
                    }
                    this.mailers.push(transporter);
                } else if (smtp["auth"]["type"] === "OAuth2") {
                    const transporter = nodemailer.createTransport({
                        "host": smtp["host"],
                        "port": smtp["port"],
                        "secure": true,
                        "auth": {
                            "type": "OAuth2",
                            "user": smtp["user"],
                            "clientId": smtp["auth"]["clientId"],
                            "clientSecret": smtp["auth"]["clientSecret"],
                            "refreshToken": smtp["auth"]["refreshToken"]
                        }
                    });
                    const res = await transporter.verify();
                    if (res === false) {
                        throw new Error("Cannot authenticate WS SMTP with provided configuration: " + JSON.stringify(smtp));
                    }
                    this.mailers.push(transporter);
                }
            }
            if (this.mailers.length === 0) {
                throw new Error("At least one WS email SMTP server must be configured!");
            }

            // Database connect
            try {
                this.db = knex({
                    "client": conf["ws"]["database"]["type"],
                    "connection": {
                        "host": conf["ws"]["database"]["host"],
                        "port": conf["ws"]["database"]["port"],
                        "user": conf["ws"]["database"]["user"],
                        "password": conf["ws"]["database"]["pass"],
                        "database": conf["ws"]["database"]["db"]
                    },
                });
            } catch (error) {
                throw new Error("Cannot connect to WS Database with provided configuration: " + error.message);
            }

            // Create db schema
            if (await this.db.schema.hasTable("users") === false) {
                await this.db.schema.createTable("users", function (table) {
                    table.string("user_id");
                    table.text("email");
                    table.text("first_name");
                    table.text("last_name");
                });
                await this.db.schema.alterTable("users", function (table) {
                    table.primary("user_id");
                    table.unique("email");
                });
            }
            if (await this.db.schema.hasTable("users_google") === false) {
                await this.db.schema.createTable("users_google", function (table) {
                    table.string("sub");
                    table.string("user_id");
                    table.text("picture");
                });
                await this.db.schema.alterTable("users_google", function (table) {
                    table.primary("sub");
                    table.foreign("user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }
            if (await this.db.schema.hasTable("sessions") === false) {
                await this.db.schema.createTable("sessions", function (table) {
                    table.string("session_id");
                    table.string("user_id");
                    table.string("session_key");
                    table.bigint("expire").unsigned();
                    table.bigint("last_used").unsigned();
                    table.text("ip_address");
                    table.text("user_agent");
                });
                await this.db.schema.alterTable("sessions", function (table) {
                    table.primary("session_id");
                    table.foreign("user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                    table.unique("session_key");
                });
            }
            if (await this.db.schema.hasTable("delete") === false) {
                await this.db.schema.createTable("delete", function (table) {
                    table.string("delete_id");
                    table.string("user_id");
                    table.string("delete_key");
                    table.bigint("expire").unsigned();
                });
                await this.db.schema.alterTable("delete", function (table) {
                    table.primary("delete_id");
                    table.foreign("user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                    table.unique("delete_key");
                });
            }
            /*
            if (await this.db.schema.hasTable("rooms") === false) {
                await this.db.schema.createTable("rooms", function (table) {
                    table.bigint("room_id").unsigned();
                    table.text("host_code");
                    table.bigint("expire").unsigned();
                });
                await this.db.schema.alterTable("rooms", function (table) {
                    table.primary("room_id");
                    table.unique("host_code");
                });
            }
            if (await this.db.schema.hasTable("resources") === false) {
                await this.db.schema.createTable("resources", function (table) {
                    table.bigint("resource_id").unsigned();
                    table.bigint("parent_id").unsigned();
                    table.bigint("room_id").unsigned();
                });
                await this.db.schema.alterTable("resources", function (table) {
                    table.primary("resource_id");
                    table.foreign("parent_id").references("resources.resource_id").onDelete("CASCADE").onUpdate("CASCADE");
                    table.foreign("room_id").references("rooms.room_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }
            if (await this.db.schema.hasTable("permissions") === false) {
                await this.db.schema.createTable("permissions", function (table) {
                    table.bigint("permission_id").unsigned();
                    table.bigint("user_id").unsigned();
                    table.boolean("can_share");
                    table.boolean("can_write");
                    table.boolean("is_owner");
                });
                await this.db.schema.alterTable("permissions", function (table) {
                    table.primary("permission_id");
                    table.foreign("user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }
            if (await this.db.schema.hasTable("permission_join") === false) {
                await this.db.schema.createTable("permission_join", function (table) {
                    table.bigint("permission_id").unsigned();
                    table.bigint("resource_id").unsigned();
                });
                await this.db.schema.alterTable("permission_join", function (table) {
                    table.index(["permission_id", "resource_id"]);
                    table.foreign("permission_id").references("permissions.permission_id").onDelete("CASCADE").onUpdate("CASCADE");
                    table.foreign("resource_id").references("resources.resource_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }*/

            // Configure auth methods
            if (typeof conf["ws"]["features"]["auth"]["google"] !== "undefined") {
                this.authGoogle = async (credential) => {
                    let userInfo = undefined;
                    try {
                        const res = await this.httpsGetText("https://oauth2.googleapis.com/tokeninfo?id_token=" + credential);
                        userInfo = JSON.parse(res);
                        if (userInfo["aud"] !== conf["ws"]["features"]["auth"]["google"]["clientId"]) {
                            throw new Error("Invalid Google OAuth2 client ID");
                        }
                        if (userInfo["email_verified"] !== "true") {
                            throw new Error("Google OAuth2 email not verified");
                        }
                        if (userInfo["exp"] < Date.now() / 1000) {
                            throw new Error("Google OAuth2 token expired");
                        }
                    } catch (error) {
                        console.log(error);
                        return undefined;
                    }
                    return userInfo;
                };
            } else {
                this.authGoogle = (credential) => {
                    return undefined;
                };
            }

            // Setup public configuration for client
            this.clientConf = {
                "webrtc": {
                    "iceServers": [...conf["ws"]["webrtc"]["iceServers"]]
                },
                "screenSharing": {
                    "isHomePage": conf["ws"]["features"]["screenSharing"]["isHomePage"],
                    "allowGuestShare": conf["ws"]["features"]["screenSharing"]["allowGuestShare"],
                    "allowGuestJoin": conf["ws"]["features"]["screenSharing"]["allowGuestJoin"]
                },
                "serviceSharing": {
                    "isHomePage": conf["ws"]["features"]["serviceSharing"]["isHomePage"]
                },
                "auth": {}
            };
            if (typeof conf["ws"]["features"]["auth"]["google"] !== "undefined") {
                this.clientConf["auth"]["google"] = {};
                this.clientConf["auth"]["google"]["clientId"] = conf["ws"]["features"]["auth"]["google"]["clientId"];
            }

            // Listen WS port
            if (conf["ws"]["port"] === conf?.["http"]?.["port"]) {
                this.wsServer = new WebSocketServer({
                    "server": this.httpServer
                });
            } else {
                this.wsHttpServer = https.createServer({
                    "key": conf["ws"]["key"],
                    "cert": conf["ws"]["cert"]
                }, function (req, res) {
                    res.writeHead(200, {
                        //"Content-Security-Policy": "default-src 'self'",
                        "Cache-Control": "no-cache, no-store, must-revalidate",
                        "Content-Length": 0,
                        "Content-Type": "text/plain"
                    });
                    res.write("");
                    res.end();
                });
                this.wsHttpServer.listen(conf["ws"]["port"]);
                this.wsServer = new WebSocketServer({
                    "server": this.wsHttpServer
                });
            }
            this.wsServer.addListener("connection", (ws) => {
                if (this.isClosing) {
                    ws.terminate();
                } else {
                    this.clientConnect(ws);
                }
            });
            process.stdout.write("done\n");
        } else {
            process.stdout.write("skipped\n");
        }

    };
    async addSession(userId, ipAddress, userAgent) {
        // create in db
        let sessionId = undefined;
        while (sessionId === undefined) {
            sessionId = generateId(10);
            const existing = await this.db.select().table("sessions").where("session_id", sessionId).first();
            if (existing !== undefined) {
                sessionId = undefined;
            }
        }
        let sessionKey = undefined;
        while (sessionKey === undefined) {
            sessionKey = generateId(10);
            const existing = await this.db.select().table("sessions").where("session_key", sessionKey).first();
            if (existing !== undefined) {
                sessionKey = undefined;
            }
        }
        const expire = Date.now() + 7 * 24 * 60 * 60 * 1000;
        const lastUsed = Date.now();
        await this.db.insert({
            "session_id": sessionId,
            "user_id": userId,
            "session_key": sessionKey,
            "expire": expire,
            "last_used": lastUsed,
            "ip_address": ipAddress,
            "user_agent": userAgent
        }).into("sessions");

        // notify subscribed clients (same userId) about new session
        const sessionsSubscription = this.subscriptions.get("sessions").get(userId);
        if (sessionsSubscription !== undefined) {
            for (const subClientId of sessionsSubscription) {
                const com = this.clients.get(subClientId).get("com");
                com.send({
                    "timestamp": Date.now(),
                    "type": "sessions",
                    "value": {
                        "sessionId": sessionId,
                        "lastUsed": lastUsed,
                        "ipAddress": ipAddress,
                        "userAgent": userAgent
                    }
                });
            }
        }

        // return session info
        return {"sessionId": sessionId, "sessionKey": sessionKey};
    };
    async updateSession(userId, sessionId, expire, lastUsed, ipAddress, userAgent) {
        // check if session exists
        const session = await this.db.select()
            .table("sessions")
            .where("session_id", sessionId)
            .andWhere("user_id", userId)
            .andWhere("expire", ">", Date.now())
            .first();

        if (session === undefined) {
            return undefined;
        }

        // update in db
        let isChanged = false;
        const change = {
            "sessionId": sessionId
        };
        if (expire !== undefined) {
            await this.db("sessions")
                .where({"session_id": sessionId})
                .andWhereNot({"expire": expire})
                .update({"expire": expire});
            // skip notification for expire change
        }

        if (lastUsed !== undefined) {
            const update = await this.db("sessions")
                .where({"session_id": sessionId})
                .andWhereNot({"last_used": lastUsed})
                .update({"last_used": lastUsed});
            if (update !== 0) {
                isChanged = true;
                change["lastUsed"] = lastUsed;
            }
        }

        if (ipAddress !== undefined) {
            const update = await this.db("sessions")
                .where({"session_id": sessionId})
                .andWhereNot({"ip_address": ipAddress})
                .update({"ip_address": ipAddress});
            if (update !== 0) {
                isChanged = true;
                change["ipAddress"] = ipAddress;
            }
        }

        if (userAgent !== undefined) {
            const update = await this.db("sessions")
                .where({"session_id": sessionId})
                .andWhereNot({"user_agent": userAgent})
                .update({"user_agent": userAgent});
            if (update !== 0) {
                isChanged = true;
                change["userAgent"] = userAgent;
            }
        }

        // broadcast to subscribed clients if changed
        if (isChanged === true) {
            const sessionsSubscription = this.subscriptions.get("sessions").get(userId);
            if (sessionsSubscription !== undefined) {
                for (const subClientId of sessionsSubscription) {
                    const com = this.clients.get(subClientId).get("com");
                    com.send({
                        "timestamp": Date.now(),
                        "type": "sessions",
                        "isChange": true,
                        "value": change
                    });
                }
            }
        }

        return isChanged;
    };
    async removeSession(userId, sessionId) {
        // delete from db
        await this.db("sessions").where({"session_id": sessionId}).delete();

        // remove all clients from session 
        const clients = this.sessions.get(sessionId);
        if (clients !== undefined) {
            for (const clientId of clients) {
                const com = this.clients.get(clientId).get("com");
                com.send({
                    "timestamp": Date.now(),
                    "type": "logout"
                });
            }
            this.sessions.delete(sessionId);

            // update clients state
            for (const clientId of clients) {
                const client = this.clients.get(clientId);
                client.set("isLoggedIn", false);
                client.delete("userId");
                client.delete("sessionId");
                client.delete("sessionKey");
            }

            // remove subscriptions from clients in deleted session
            const it = this.subscriptions.entries();
            for (const [type, subsMap] of it) {
                const userSubs = subsMap.get(userId);
                if (userSubs !== undefined) {
                    for (const clientId of clients) {
                        userSubs.delete(clientId);
                        if (userSubs.size === 0) {
                            subsMap.delete(userId);
                        }
                    }
                }
            }
        }

        // notify other subscribed clients (same userId) about removed session
        const sessionsSubscription = this.subscriptions.get("sessions").get(userId);
        if (sessionsSubscription !== undefined) {
            for (const subClientId of sessionsSubscription) {
                const com = this.clients.get(subClientId).get("com");
                com.send({
                    "timestamp": Date.now(),
                    "type": "sessions",
                    "isRemove": true,
                    "value": sessionId
                });
            }
        }

    };
    addClientSession(userId, sessionId, clientId) {
        // add session to sessions map
        const clientsSet = this.sessions.get(sessionId);
        if (clientsSet === undefined) {
            this.sessions.set(sessionId, new Set([clientId]));
        } else {
            clientsSet.add(clientId);
        }

        // update state
        const client = this.clients.get(clientId);
        
        client.set("isLoggedIn", true);
        client.set("userId", userId);
        client.set("sessionId", sessionId);
    };
    removeClientSession(userId, sessionId, clientId) {
        // remove from sessions map
        const clientsSet = this.sessions.get(sessionId);
        if (clientsSet !== undefined) {
            clientsSet.delete(clientId);
            if (clientsSet.size === 0) {
                this.sessions.delete(sessionId);
            }
        }

        // update client state
        const client = this.clients.get(clientId);
        client.set("isLoggedIn", false);
        client.delete("userId");
        client.delete("sessionId");
        client.delete("sessionKey");

        // remove subscriptions
        const it = this.subscriptions.entries();
        for (const [type, subsMap] of it) {
            const userSubs = subsMap.get(userId);
            if (userSubs !== undefined) {
                userSubs.delete(clientId);
                if (userSubs.size === 0) {
                    subsMap.delete(userId);
                }
            }
        }
        
    };
    addClientSubscription(type, userId, clientId) {
        const subscriptions = this.subscriptions.get(type);
        const userSubscriptions = subscriptions.get(userId);
        if (userSubscriptions === undefined) {
            subscriptions.set(userId, new Set([clientId]));
        } else {
            userSubscriptions.add(clientId);
        }
    };
    removeClientSubscription(type, userId, clientId) {
        const subscriptions = this.subscriptions.get(type);
        const userSubscriptions = subscriptions.get(userId);
        if (userSubscriptions !== undefined) {
            userSubscriptions.delete(clientId);
            if (userSubscriptions.size === 0) {
                subscriptions.delete(userId);
            }
        }
    };
    async updateUserData(userId, type, data) {
        let subscribedClients;
        let value;
        if (type === "picture") {
            const user = await this.db.select().table("users_google").where("user_id", userId).first();
            if (typeof user === "undefined" || user["picture"] === data) {
                return;
            }
            await this.db("users_google").where("user_id", userId).update({"picture": data});
            subscribedClients = this.subscriptions.get("picture").get(userId);
            const imageData = await this.httpsGetImage(data);
            value = imageData;

        }  else if (type === "email") {
            const user = await this.db.select().table("users").where("user_id", userId).first();
            if (typeof user === "undefined" || user["email"] === data) {
                return;
            }
            await this.db("users").where("user_id", userId).update({"email": data});
            subscribedClients = this.subscriptions.get("email").get(userId);
            value = data;

        } else if (type === "firstName") {
            const user = await this.db.select().table("users").where("user_id", userId).first();
            if (typeof user === "undefined" || user["first_name"] === data) {
                return;
            }
            await this.db("users").where("user_id", userId).update({"first_name": data});
            subscribedClients = this.subscriptions.get("firstName").get(userId);
            value = data;

        } else if (type === "lastName") {
            const user = await this.db.select().table("users").where("user_id", userId).first();
            if (typeof user === "undefined" || user["last_name"] === data) {
                return;
            }
            await this.db("users").where("user_id", userId).update({"last_name": data});
            subscribedClients = this.subscriptions.get("lastName").get(userId);
            value = data;
        }

        // broadcast to subscribed clients
        if (subscribedClients !== undefined) {
            for (const clientId of subscribedClients) {
                const com = this.clients.get(clientId).get("com");
                const messageObj = com.send({
                    "timestamp": Date.now(),
                    "type": type,
                    "value": value
                });
                await messageObj.wait();
            }
        }

    };
    async handleAPI(messageObj, clientId) {
        //check basic structure
        await messageObj.wait();
        const message = messageObj.data;
        if (typeof message !== "object" && typeof message["type"] !== "string") {
            console.log("Invalid message format", message);
            messageObj.abort();
            return;
        }
        const client = this.clients.get(clientId);

        // refresh session
        if (client.get("isLoggedIn") === true) {
            const ip = client.get("ws")._socket.remoteAddress;
            const result = await this.updateSession(client.get("userId"), client.get("sessionId"), Date.now() + 7 * 24 * 60 * 60 * 1000, Date.now(), ip, undefined);
            if (result === undefined) {
                // session expired
                await this.removeSession(client.get("userId"), client.get("sessionId"));
            }
        }
        
        // config getter
        if (message["type"] === "conf-get") {
            messageObj.send(this.clientConf);
            return;
        }
        
        // account management
        if (message["type"] === "login-google") {
            /*{
                "credential": string
            }*/
           /*{
                "success": boolean,
                "sessionId": string,
                "sessionKey": string
            }*/
            // check inputs
            const credential = message["credential"];
            const userAgent = message["userAgent"];
            if (typeof credential !== "string" || typeof userAgent !== "string") {
                messageObj.send({"success": false});
                return;
            }
            
            // check credential
            const userInfo = await this.authGoogle(credential);
            if (typeof userInfo === "undefined") {
                messageObj.send({"success": false});
                return;
            }

            // check already logged in
            if (client.get("isLoggedIn") === true) {
                const exitsUser = await this.db.select().table("users_google").where({"sub": userInfo["sub"], "user_id": client.get("userId")}).first();
                if (typeof exitsUser !== "undefined") {
                    const session = await this.db.select().table("sessions").where("session_id", client.get("sessionId")).andWhere("expire", ">", Date.now()).first();
                    messageObj.send({
                        "success": true,
                        "sessionId": session["session_id"],
                        "sessionKey": session["session_key"]
                    });
                    return;
                }
                // logout previous session
                await this.removeSession(client.get("userId"), client.get("sessionId"));
            }

            // search for existing user
            let exitsUser = await this.db.select().table("users_google").where("sub", userInfo["sub"]).first();

            // create user if not exists
            if (typeof exitsUser === "undefined") {
                // generate new user id
                let userId = undefined;
                while (typeof userId === "undefined") {
                    userId = generateId(10);
                    const existing = await this.db.select().table("users").where("user_id", userId).first();
                    if (existing !== undefined) {
                        userId = undefined;
                    }
                }

                // insert into users table
                await this.db.insert({
                    "user_id": userId,
                    "email": userInfo["email"],
                    "first_name": userInfo["given_name"],
                    "last_name": userInfo["family_name"]
                }).into("users");

                // insert into users_google table
                await this.db.insert({
                    "sub": userInfo["sub"],
                    "user_id": userId,
                    "picture": userInfo["picture"]
                }).into("users_google");

                exitsUser = {
                    "user_id": userId
                };
            }

            // update account data if changed
            this.updateUserData(exitsUser["user_id"], "email", userInfo["email"]);
            this.updateUserData(exitsUser["user_id"], "firstName", userInfo["given_name"]);
            this.updateUserData(exitsUser["user_id"], "lastName", userInfo["family_name"]);
            this.updateUserData(exitsUser["user_id"], "picture", userInfo["picture"]);

            // create session
            const ip = client.get("ws")._socket.remoteAddress;
            const { sessionId, sessionKey } = await this.addSession(exitsUser["user_id"], ip, userAgent);
            this.addClientSession(exitsUser["user_id"], sessionId, clientId);

            messageObj.send({
                "success": true,
                "sessionId": sessionId,
                "sessionKey": sessionKey
            });
            return;
        }

        if (message["type"] === "login-session") {
            /*{
                "sessionKey": string
            }*/
            /*{
                "success": boolean
            }*/
            // check inputs
            const sessionKey = message["sessionKey"];
            if (typeof sessionKey !== "string") {
                messageObj.send({"success": false});
                return;
            }

            // check session in db
            const session = await this.db.select().table("sessions").where("session_key", sessionKey).andWhere("expire", ">", Date.now()).first();
            if (session === undefined) {
                messageObj.send({"success": false});
                return;
            }
            await this.db.update({"expire": Date.now() + 7 * 24 * 60 * 60 * 1000}).table("sessions").where("session_key", sessionKey);

            // check already logged in
            if (client.get("isLoggedIn") === true) {
                if (session["user_id"] === client.get("userId")) {
                    messageObj.send({
                        "success": true
                    });
                    return;
                }
                // logout previous session
                this.removeClientSession(client.get("userId"), client.get("sessionId"), clientId);
            }

            // add session to client
            this.addClientSession(session["user_id"], session["session_id"], clientId);

            messageObj.send({
                "success": true
            });
            return;
        }

        if (message["type"] === "logout") {
            /*{
                "sessionId": string
            }*/
            /*{
                "success": boolean
            }*/
            // check logged in
            if (client.get("isLoggedIn") !== true) {
                messageObj.send({"success": false});
                return;
            }

            // check inputs
            let sessionId = message["sessionId"];
            if (typeof sessionId !== "string") {
                sessionId = client.get("sessionId");
            }

            // check permission
            const session = await this.db.select().table("sessions")
                .where({
                    "session_id": sessionId,
                    "user_id": client.get("userId")
                })
                .andWhere("expire", ">", Date.now()).first();
            if (session === undefined) {
                messageObj.send({"success": false});
                return;
            }

            if (sessionId === client.get("sessionId")) {
                this.removeClientSession(session["user_id"], sessionId, clientId);  // prevent event send 
            }
            await this.removeSession(session["user_id"], sessionId);
            messageObj.send({"success": true});
            return;
        }

        if (message["type"] === "user-data-subscribe") {
            /*{
                "key": string,
                "once": boolean
                ...params
            }*/
            /*{
                "success": boolean,
                "value": any
            }*/
            // check inputs
            const key = message["key"];
            if (typeof key !== "string" || !["email", "firstName", "lastName", "picture", "sessions"].includes(key)) {
                messageObj.send({"success": false});
                return;
            }
            const once = message["once"];

            // check permission
            if (client.get("isLoggedIn") !== true) {
                messageObj.send({"success": false});
                return;
            }

            let value;
            const user = await this.db.select().table("users").where("user_id", client.get("userId")).first();
            if (key === "email") {
                value = user["email"];
            } else if (key === "firstName") {
                value = user["first_name"];
            } else if (key === "lastName") {
                value = user["last_name"];
            } else if (key === "picture") {
                const userGoogle = await this.db.select().table("users_google").where("user_id", client.get("userId")).first();
                const imageData = await this.httpsGetImage(userGoogle["picture"]);
                value = imageData;
            } else if (key === "sessions") {
                const sessions = await this.db.select().table("sessions").where("user_id", client.get("userId")).andWhere("expire", ">", Date.now());
                value = [];
                for (const session of sessions) {
                    value.push({
                        "sessionId": session["session_id"],
                        "expire": session["expire"],
                        "lastUsed": session["last_used"],
                        "ipAddress": session["ip_address"],
                        "userAgent": session["user_agent"]
                    });
                }
            }

            // subscribe to updates
            if (once !== true) {
                this.addClientSubscription(key, client.get("userId"), clientId);
            }

            // send current data
            messageObj.send({"success": true, "value": value});
            return;
        }

        if (message["type"] === "user-data-unsubscribe") {
            /*{
                "key": string
            }*/
            /*{
                "success": boolean
            }*/
            // check inputs
            const key = message["key"];
            if (typeof key !== "string" || !["email", "firstName", "lastName", "picture", "sessions"].includes(key)) {
                messageObj.send({"success": false});
                return;
            }

            // check permission
            if (client.get("isLoggedIn") !== true) {
                messageObj.send({"success": false});
                return;
            }

            this.removeClientSubscription(key, client.get("userId"), clientId);
            messageObj.send({"success": true});
            return;
        }

        if (message["type"] === "delete-email") {
            /*{
                "lang": string
            }*/
            /*{
                "success": boolean
            }*/
            // check permission
            if (client.get("isLoggedIn") !== true) {
                messageObj.send({"success": false});
                return;
            }

            // check inputs
            let lang = message["lang"];
            if (typeof lang !== "string" || !["en", "hu"].includes(lang)) {
                lang = "en";
            }

            // generate delete id
            let deleteId = undefined;
            while (deleteId === undefined) {
                deleteId = generateId(10);
                const existing = await this.db.select().table("delete").where("delete_id", deleteId).first();
                if (existing !== undefined) {
                    deleteId = undefined;
                }
            }

            // generate delete key
            let deleteKey = undefined;
            while (deleteKey === undefined) {
                deleteKey = generateId(10);
                const existing = await this.db.select().table("delete").where("delete_key", deleteKey).first();
                if (existing !== undefined) {
                    deleteKey = undefined;
                }
            }

            // insert into delete table
            await this.db.insert({
                "delete_id": deleteId,
                "user_id": client.get("userId"),
                "delete_key": deleteKey,
                "expire": Date.now() + 1 * 60 * 60 * 1000
            }).into("delete");

            // send delete email
            const user = await this.db.select().table("users").where("user_id", client.get("userId")).first();
            try {
                await this.mailers[0].sendMail({
                    "from": this.mailers[0].options.auth.user,
                    "to": user["email"],
                    "subject": "Account Deletion Request",
                    "text": 
                        getText("delete.0", lang) + this.domain + 
                        getText("delete.1", lang) + "\n\n" + deleteKey + "\n\n" +
                        getText("delete.2", lang)
                });
            } catch (error) {
                messageObj.send({"success": false});
                console.log("Error sending delete email:", error);
                return;
            }
            messageObj.send({"success": true});
            return;
        }

        if (message["type"] === "delete") {
            /*{
                "deleteKey": string
            }*/
            /*{
                "success": boolean
            }*/

            // check inputs
            const deleteKey = message["deleteKey"];
            if (typeof deleteKey !== "string") {
                messageObj.send({"success": false});
                return;
            }

            // check permission
            if (client.get("isLoggedIn") !== true) {
                messageObj.send({"success": false});
                return;
            }
            const userId = client.get("userId");
            const sessionId = client.get("sessionId");
            const deleteEntry = await this.db.select().table("delete").where({"user_id": userId, "delete_key": deleteKey}).andWhere("expire", ">", Date.now()).first();
            if (deleteEntry === undefined) {
                messageObj.send({"success": false});
                return;
            }

            messageObj.send({"success": true});

            // delete client in sessions and logout other clients
            this.removeClientSession(userId, sessionId, clientId);
            const sessions = await this.db.select().table("sessions").where("user_id", userId);
            if (sessions !== undefined) {
                for (const session of sessions) {
                    await this.removeSession(session["user_id"], session["session_id"]);
                }
            }

            // delete user from db
            await this.db("users").where("user_id", userId).delete();
            return;
        }
        /*
        events:
        {
            "timestamp": number,
            "type": string // "logout" | "email" | "firstName" | "lastName" | "picture" | "sessions"
            "isChange": boolean,
            "isAdd": boolean,
            "isRemove": boolean,
            "value": any
        }*/

        // share management
        // ...

        // unknown API
        console.log("Invalid request");
        messageObj.abort();
        return;
    };
    async clientConnect(ws) {
        // generate clientId for connection
        let clientId;
        do {
            clientId = Math.floor(Math.random() * 9999) + 1;
        } while (this.clients.has(clientId));  
        
        // create communicator
        const com = new Communicator({
            "sender": async function(data, transfer, message) {
                if ((data instanceof ArrayBuffer) === false) {
                    data = JSON.stringify(data);
                }
                ws.send(data);
            },
            "interactTimeout": 3000,
            "timeout": 5000,
            "packetSize": 1000,
            "packetTimeout": 1000,
            "packetRetry": Infinity,
            "sendThreads": 16
        });
        ws.addEventListener("message", function(event) {
            let data = event.data;  // can be string or ArrayBuffer
            try {
                if (typeof data === "string") {
                    data = JSON.parse(data);
                } else {
                    data = new Uint8Array(data);
                    data = data.buffer;
                }
            } catch (error) {
                console.log(error);
                return;
            }
            com.receive(data);

        });
        await com.sideSync();
        await com.timeSync();

        // create state
        /*{
            "com": Communicator,
            "ws": WebSocket,
            "isLoggedIn": false,
            "userId": undefined,
            "sessionId": undefined
        }*/
        const client = new Map([
            ["com", com],
            ["ws", ws],
            ["isLoggedIn", false]
        ]);
        this.clients.set(clientId, client);

        // listen messages and handle API
        com.onIncoming(async (messageObj) => {
            try {
                await this.handleAPI(messageObj, clientId);
            } catch (error) {
                console.log("Error handling message:", error);
                client.get("ws").terminate();
            }
            
        });

        // listen error
        ws.addEventListener("error", (event) => {
            console.log("Error " + event.error);
        });

        // listen close
        ws.addEventListener("close", () => {
            // clean up
            const client = this.clients.get(clientId);
            if (client.get("isLoggedIn") === true) {
                this.removeClientSession(client.get("userId"), client.get("sessionId"), clientId);
            }
            this.clients.delete(clientId);
            
            console.log("Client disconnected (" + clientId + ")");
        });

        // debug info
        console.log("Client connected (" + clientId.toString().padStart(4, "0") + ")");

    };
    async stop() {
        this.isClosing = true;
        
        process.stdout.write("\n    Closing WS server....    ");
        if (this.wsServer !== null) {
            // close WS server and its connections
            await new Promise((resolve) => {
                let round = 0;
                const close = () => {
                    if (round === 0) {
                        // First sweep, soft close
                        this.wsServer.clients.forEach(function (socket) {
                            socket.close();
                        });
                    } else if (round < 20) {
                        // Check clients
                        let isAllClosed = true;
                        for (const socket of this.wsServer.clients) {
                            if ([socket.OPEN, socket.CLOSING].includes(socket.readyState)) {
                                isAllClosed = false;
                                break;
                            }
                        }
                        if (isAllClosed === true) {
                            resolve(true);
                            return;
                        }
                    } else {
                        // Last sweep, hard close for everyone who's left
                        this.wsServer.clients.forEach(function(socket) {
                            if ([socket.OPEN, socket.CLOSING].includes(socket.readyState)) {
                                socket.terminate();
                            }
                        });
                        resolve(true);
                        return;
                    }
                    round++;
                    setTimeout(close, 500);
                };
                close();
                
            });

            // close WS HTTP server if exists
            if (this.wsHttpServer !== null) {
                await new Promise((resolve) => {
                    const timeOut = setTimeout(function() {
                        resolve(false);
                    }, 5000);
                    this.httpRedirect.close(function() {
                        clearTimeout(timeOut);
                        resolve(true);
                    });
                });
            }
            process.stdout.write("done\n");
        } else {
            process.stdout.write("skipped\n");
        }

        process.stdout.write("\n    Closing HTTP server....    ");
        if (this.httpServer !== null) {
            // close redirect server if exists
            if (this.httpRedirect !== null) {
                await new Promise((resolve) => {
                    const timeOut = setTimeout(function() {
                        resolve(false);
                    }, 5000);
                    this.httpRedirect.close(function() {
                        clearTimeout(timeOut);
                        resolve(true);
                    });
                });
            }
            
            // close HTTP server
            await new Promise((resolve) => {
                const timeOut = setTimeout(function() {
                    resolve(false);
                }, 5000);
                this.httpServer.close(function() {
                    clearTimeout(timeOut);
                    resolve(true);
                });
            });
            process.stdout.write("done\n");
        } else {
            process.stdout.write("skipped\n");
        }

        // clear cache
        this.httpCache.clear();

    };
};


//
// Main
//
const main = async function(args) {
    // Read CLI options
    process.stdout.write("Reading arguments...    ");
    const confPath = path.resolve(getArg(process.argv, "--configuration", true, true) || getArg(process.argv, "-c", true, false) || "./conf/conf.json");
    const complieFlag = getArg(process.argv, "--compile", false) || false;
    const exitFlag = getArg(process.argv, "--exit", false) || false;
    process.stdout.write("done\n");

    
    // Process the configuration and parameters
    process.stdout.write("Load the configuration...    ");
    const conf = await processConf(confPath);
    conf["flags"] = {};
    conf["flags"]["compile"] = complieFlag;
    conf["flags"]["exit"] = exitFlag;
    process.stdout.write("done\n");


    // Compile the clients
    process.stdout.write("Compiling clients...    ");
    const isDone = await compileClients(conf);
    if (isDone) {
        process.stdout.write("done\n");
    } else {
        process.stdout.write("skipped\n");
    }

    // Start HTTP/WS server
    const server = new Server();
    await server.start(conf);

    // Cleanup
    const close = async function() {
        process.stdout.write("Exiting....    ");
        await server.stop();
        process.stdout.write("done\n");
        process.exit(0); 
    };
    process.stdout.write("Press CTRL+C to stop servers\n");
    process.on("SIGTERM", async function() {
        process.stdout.write("SIGTERM signal received\n");
        await close();
    });
    process.on("SIGINT", async function() {
        process.stdout.write("SIGINT signal received\n");
        await close();
    });
    if (conf["flags"]["exit"]) {
        process.stdout.write("--exit flag received\n");
        await close();
    }
};
main(process.argv);