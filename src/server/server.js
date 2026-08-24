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
import localization from "./localization.js";
import { argGet } from "./common.js";


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






//
// Main
//
const main = async function(args) {
    // Help / version (checked before anything else, no other output)
    const helpFlag = argGet(process.argv, "--help", false) || argGet(process.argv, "-h", false);
    if (helpFlag) {
        console.log("Usage: npm run server [-- --configuration=<path>] [-- --compile] [-- --exit] [-- --help] [-- --version]\n\n  -c, --configuration <path>  path to the JSON configuration file (default: ./conf/conf.json)\n  --compile                    force (re)compile the Electron client bundles from ./bin into ./tmp\n  --exit                       validate the configuration/compile and exit without starting listeners\n  -h, --help                   show this help message\n  -v, --version                show the project version");
        return;
    }

    const versionFlag = argGet(process.argv, "--version", false) || argGet(process.argv, "-v", false);
    if (versionFlag) {
        const packageJsonPath = path.resolve(import.meta.dirname, "../../package.json");
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
        console.log(packageJson.version);
        return;
    }

    // Read CLI options
    process.stdout.write("Reading arguments...    ");
    const confPath = path.resolve(argGet(process.argv, "--configuration", true, true) || argGet(process.argv, "-c", true, false) || "./conf/conf.json");
    const compileFlag = argGet(process.argv, "--compile", false) || false;
    const exitFlag = argGet(process.argv, "--exit", false) || false;
    process.stdout.write("done\n");

    
    // Process the configuration and parameters
    process.stdout.write("Load the configuration...    ");
    /*const conf = await processConf(confPath);
    conf["flags"] = {};
    conf["flags"]["compile"] = compileFlag;
    conf["flags"]["exit"] = exitFlag;*/
    process.stdout.write("done\n");


    // Compile the clients
    process.stdout.write("Compiling clients...    ");
    /*const isDone = await compileClients(conf);*/
    if (true) {
        process.stdout.write("done\n");
    } else {
        process.stdout.write("skipped\n");
    }

    // Start HTTP/WS server
    /*const server = new Server();
    await server.start(conf);*/

    // Cleanup
    const close = async function() {
        process.stdout.write("Exiting....    ");
        //await server.stop();
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
    /*if (conf["flags"]["exit"]) {
        process.stdout.write("--exit flag received\n");
        await close();
    }*/
};
main(process.argv);