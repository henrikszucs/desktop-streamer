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
import { type } from "node:os";

const CLIENT_VERSION = "0.1.0";
const MIN_CLIENT_VERSION = CLIENT_VERSION;

//
// Helper functions
//

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
    // check conf
    if (typeof conf["http"] !== "object") {
        throw new Error("HTTP configuration is required for client compilation!");
    }

    // secure compile path
    const compilePath = "./tmp";
    let isCompiled = false;
    try {
        await fs.access(compilePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
        // create compile path if not exists
        try {
            await fs.mkdir(compilePath, { recursive: true });
        } catch (error) {
            throw new Error("Cannot create compile path: " + compilePath + " - " + error.message);
        }
    }

    // check existing compiled files
    isCompiled = await isDirEmpty(compilePath);

    // exit if compile is not requested and already compiled
    if (conf["flags"]["compile"] === false && isCompiled) {
        return false;
    }

    //remove old compiled files
    for (const file of await fs.readdir(compilePath)) {
        await fs.rm(path.join(compilePath, file), { recursive: true, force: true });
    }

    // read electron dist
    const electronDistPath = path.join(serverScriptPath, "client", "electron", "dist");
    const dists = [];
    try {
        const elements = await fs.readdir(electronDistPath);
        for (const element of elements) {
            const elementPath = path.join(electronDistPath, element);
            const isDir = (await fs.stat(elementPath)).isDirectory();
            if (isDir && element.split("-").length === 2) {
                dists.push([elementPath, element]);
            }
        }
    }
    catch (error) {
        console.error("Cannot read electron dist path: " + electronDistPath + " - " + error.message);
        return false;
    }
    if (dists.length === 0) {
        console.error("No electron dist found in: " + electronDistPath);
        return false;
    }

    // generate conf script
    const confData = {
        "http": {
            "domain": conf["http"]["domain"],
            "port": conf["http"]["port"],
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

    // read web files
    const webPath = path.join(serverScriptPath, "client", "web");
    const webFiles = await fs.readdir(webPath, {"recursive": true});

    // go through the dists
    const commonPath = path.join(serverScriptPath, "client", "electron", "common");
    for (const [distPath, distName] of dists) {
        const system = distName.split("-")[0];
        const arch = distName.split("-")[1];
        process.stdout.write("\n    Compiling " + distName + "...    ");

        // create the zips
        const zip = new JSZip();

        // go through dist files
        const distFiles = await fs.readdir(distPath, {"recursive": true});
        for (const file of distFiles) {
            const filePath = path.join(distPath, file);
            const isDir = (await fs.stat(filePath)).isDirectory();
            if (isDir) {
                zip.folder(file);
            } else {
                const fileContents = await fs.readFile(filePath);
                zip.file(file, fileContents);
            }
        }
        
        // go through common files
        const commonFiles = await fs.readdir(commonPath, {"recursive": true});
        let commonDest = path.join("resources", "app");
        if (system === "macos") {
            commonDest = path.join("Electron.app", "Contents", "Resources", "app");
        }
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
        for (const file of commonFiles) {
            const filePath = path.join(commonPath, file);
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
        const zipFileName =  system + "-" + arch + ".zip";
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
    clients = new Map();
    clientsByCallingId = new Map();
    clientConf = {};
    authGoogle = null;

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

                    // check file in file set cache
                    if (this.httpCache.has(filePath) === false) {
                        filePath = "index.html"; 
                    }

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
                        res.end(); //end the response
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
                } else if (smtp["auth"]["type"] !== "OAuth2") {
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
                }
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
                    table.bigint("user_id");
                    table.text("email");
                    table.text("first_name");
                    table.text("last_name");
                    table.text("password");
                    table.boolean("is_activated");
                });
                await this.db.schema.alterTable("users", function (table) {
                    table.primary("user_id");
                    table.unique("email");
                });
            }
            if (await this.db.schema.hasTable("sessions") === false) {
                await this.db.schema.createTable("sessions", function (table) {
                    table.bigint("session_id");
                    table.bigint("user_id");
                    table.bigint("expires");
                    table.text("details");
                });
                await this.db.schema.alterTable("sessions", function (table) {
                    table.primary("session_id");
                    table.foreign("user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }
            if (await this.db.schema.hasTable("login_codes") === false) {
                await this.db.schema.createTable("login_codes", function (table) {
                    table.bigint("code_id");
                    table.bigint("user_id");
                    table.bigint("client_secret");
                    table.bigint("expires");
                });
                await this.db.schema.alterTable("login_codes", function (table) {
                    table.primary("code_id");
                    table.foreign("user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }
            if (await this.db.schema.hasTable("activate") === false) {
                await this.db.schema.createTable("activate", function (table) {
                    table.bigint("activation_id");
                    table.bigint("user_id");
                    table.bigint("expires");
                });
                await this.db.schema.alterTable("activate", function (table) {
                    table.primary("activation_id");
                    table.foreign("user_id").references("users.user_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }
            if (await this.db.schema.hasTable("rooms") === false) {
                await this.db.schema.createTable("rooms", function (table) {
                    table.bigint("room_id");
                    table.text("host_code");
                    table.bigint("expires");
                });
                await this.db.schema.alterTable("rooms", function (table) {
                    table.primary("room_id");
                });
            }
            if (await this.db.schema.hasTable("resources") === false) {
                await this.db.schema.createTable("resources", function (table) {
                    table.bigint("resource_id");
                    table.bigint("parent_id");
                    table.bigint("room_id");
                });
                await this.db.schema.alterTable("resources", function (table) {
                    table.primary("resource_id");
                    table.setNullable("parent_id");
                    table.foreign("parent_id").references("resources.resource_id").onDelete("CASCADE").onUpdate("CASCADE");
                    table.setNullable("room_id");
                    table.foreign("room_id").references("rooms.room_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }
            if (await this.db.schema.hasTable("permissions") === false) {
                await this.db.schema.createTable("permissions", function (table) {
                    table.bigint("permission_id");
                    table.bigint("user_id");
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
                    table.bigint("permission_id");
                    table.bigint("resource_id");
                });
                await this.db.schema.alterTable("permission_join", function (table) {
                    table.index(["permission_id", "resource_id"]);
                    table.foreign("permission_id").references("permissions.permission_id").onDelete("CASCADE").onUpdate("CASCADE");
                    table.foreign("resource_id").references("resources.resource_id").onDelete("CASCADE").onUpdate("CASCADE");
                });
            }


            // Configure auth methods
            if (typeof conf["ws"]["features"]["auth"]["google"] !== "undefined") {
                this.authGoogle = async (credential) => {
                    let userInfo = undefined;
                    try {
                        const res = await this.httpsGetText("https://oauth2.googleapis.com/tokeninfo?id_token=" + credential);
                        userInfo = JSON.parse(res);
                    } catch (error) {
                        console.log(error);
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
    async clientConnect(ws) {
        let clientId;
        do {
            clientId = (Math.floor(Math.random() * 9999) + 1).toString().padStart(4, "0");
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
        this.clients.set(clientId, com);
        console.log("Client connected (" + clientId + ")");

        // listen messages
        com.onIncoming(async (messageObj) => {
            await messageObj.wait();
            const message = messageObj.data;

            //check basic structure
            if (typeof message !== "object" && typeof message["type"] !== "string") {
                console.log("Invalid message format", message);
                messageObj.abort();
                return;
            }

            // config check
            if (message["type"] === "conf-get") {
                messageObj.send(this.clientConf);
                return;
            }

            if (message["type"] === "login-google") {
                const userInfo = await this.authGoogle(messageObj.data["credential"]);
                let sessionId = undefined;

                messageObj.send({"sessionId": sessionId});
                return;
            }

            if (message["type"] === "login-check") {
                const sessionId = message["sessionId"];
                return;
            }

            if (message["type"] === "get-resources") {
                return;
            }

            if (message["type"] === "create-share") {
                
                if (typeof message["code"] === "string") {
                    // create existing

                } else {
                    // create new

                }
                return;
            }

            if (message["type"] === "join-room") {

                return;
            }

            console.log("Invalid request");
            messageObj.abort();
            return;
        });

        // listen error
        ws.addEventListener("error", (event) => {
            console.log("Error " + event.error);
        });

        // listen close
        ws.addEventListener("close", () => {
            console.log("Client disconnected (" + clientId + ")");
            this.clients.delete(clientId);
        });


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