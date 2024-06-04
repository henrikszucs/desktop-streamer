"use strict";
//import
const path = require("node:path");
const process = require("node:process");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const url = require("node:url");
const http = require("node:http");
const https = require("node:https");


const mime = require("./libs/mime.js");

const JSZip = require("jszip");
const mysql = require("mysql");
const ws = require("ws");
const nodemailer = require("nodemailer");





// General functions
/**
 * Get a named CLI argument
 * @param {Object<Array>} args - Array of arguments
 * @param {string} argName - Argument to search
 * @param {string} def - Default value if argument not found
 */
const getArg = function(args, argName, def = "") {
    for (const arg of args) {
        if (arg.startsWith(argName)) {
            return arg.slice(argName.length);
        }
    }
    return def;
};

const cutEdges = function (str) {
    return str.slice(1, str.length-1);
};

const sortedIndex = function(array, value) {
	let low = 0;
    let high = array.length;
	while (low < high) {
		const mid = low + high >>> 1;
		if (array[mid] < value) {
            low = mid + 1;
        } else {
            high = mid;
        }
	}
	return low;
};


// global MySQL general functions
const mysqlConnect = async function(mysql, data) {
    return new Promise(function(resolve, reject) {
        const con = mysql.createConnection(data);
        con.connect(function(err) {
            if (err) {
                reject(err);
            }
            resolve(con);
        });
    });

};

const mysqlClose = async function(con) {
    return new Promise(function(resolve) {
        con.end(function(err) {
            if (err) {
                resolve(false);
            }
            resolve(true);
        });
    })
};

const mysqlChangeDatabase = async function(con, dbName) {
    return new Promise(async function(resolve, reject) {
        const changeObj = {
            "database" : cutEdges(con.escapeId(dbName))
        };
        con.changeUser(changeObj, function(err) {
            if (err) {
                reject(false);
            } else {
                resolve(true);
            }
        });
    });
};

/**
 * Promisify verion of sqlite3 API
 * @param {Object<Sqlite3>} db - Database access
 * @param {string} query - SQL query
 * @returns {Object<Promise<Array>>}
 */
const mysqlQuery = async function(con, query) {
    return new Promise(function(resolve, reject) {
        con.query(query, function(error, results, fields) {
            if (error) {
                reject(error);
            }
            resolve(results);
        });
    });
};
/**
 * Check if value exist int table's column
 * @param {Object<Sqlite3>} db - Database access
 * @param {string} table - table name to search
 * @param {string} col - column where search
 * @param {string} val - value to search
 * @returns {Object<Promise<boolean>>}
 */
const mysqlCheckExist = async function(con, table, col, val) {
    const res = await mysqlQuery(con, `
        SELECT ` + con.escapeId(col) + `
        FROM ` + con.escapeId(table) + `
        WHERE ` + con.escapeId(col) + ` = ` + con.escape(val) + `
        LIMIT 1
    `);
    if (res.length !== 0) {
        return true;
    }
    return false;
};






// Global configuration parse
const initialSetup = async function(confPath) {
    let confIn = {};
    let confOut = {};

    //this will convert path if relative to configuration file
    const confPathToAbsolute = function(src) {
        if (path.isAbsolute(src) === false) {
            src = path.join(process.cwd(), path.dirname(confPath), src);
        }
        return path.resolve(src);
    };
    
    //load conf file (required)
    const contents = await fs.readFile(confPath, {
        "encoding": "utf8"
    });
    confIn = JSON.parse(contents);
    if (typeof confIn !== "object") {
        throw new Error("Invalid JSON format!");
    }
    
    //check port value (required)
    if (typeof confIn["port"] !== "number" || Number.isInteger(confIn["port"]) === false || confIn["port"] < 0) {
        throw new Error("Invalid port number!");
    }
    confOut["port"] = confIn["port"];
    
    //check key and cert (optional)
    if (typeof confIn["https"] === "object") {
        //check cert path
        if (typeof confIn["https"]["key"] !== "string" && typeof confIn["https"]["cert"] !== "string") {
            throw new Error("Invalid cert or key path!");
        }
        confIn["https"]["key"] = confPathToAbsolute(confIn["https"]["key"]);
        confIn["https"]["cert"] = confPathToAbsolute(confIn["https"]["cert"]);
        //read cert
        confIn["https"]["key"] = await fs.readFile(confIn["https"]["key"], {
            "encoding": "utf8"
        });
        confIn["https"]["cert"] = await fs.readFile(confIn["https"]["cert"], {
            "encoding": "utf8"
        });
        //copy cert data
        confOut["https"] = {};
        confOut["https"]["key"] = confIn["https"]["key"];
        confOut["https"]["cert"] = confIn["https"]["cert"];
        //check redirect (optional)
        if (typeof confIn["https"]["redirectFrom"] !== "undefined") {
            if (typeof confIn["https"]["redirectFrom"] !== "number" || Number.isInteger(confIn["https"]["redirectFrom"]) === false || confIn["https"]["redirectFrom"] < 0 || confIn["https"]["redirectFrom"] === confOut["port"]) {
                throw new Error("Invalid redirect port number!");
            }
            confOut["https"]["redirectFrom"] = confIn["https"]["redirectFrom"];
        }
    }
    
    //check and create database (required)
    if (typeof confIn["db"] !== "object") {
        throw new Error("Invalid database connection object!");
    }
    if (typeof confIn["db"]["host"] !== "string") {
        throw new Error("Invalid database host format!");
    }
    if (typeof confIn["db"]["port"] !== "number" || Number.isInteger(confIn["db"]["port"]) === false || confIn["db"]["port"] < 0) {
        throw new Error("Invalid database host format!");
    }
    if (typeof confIn["db"]["user"] !== "string") {
        throw new Error("Invalid database user format!");
    }
    if (typeof confIn["db"]["pass"] !== "string") {
        throw new Error("Invalid database pass format!");
    }
    if (typeof confIn["db"]["database"] !== "string") {
        throw new Error("Invalid database name format!");
    }
    //check and connect database
    confOut["con"] = await mysqlConnect(mysql, {
        "host": confIn["db"]["host"],
        "port": confIn["db"]["port"],
        "user": confIn["db"]["user"],
        "password": confIn["db"]["pass"]
    });
    await mysqlQuery(confOut["con"], "CREATE DATABASE IF NOT EXISTS  " + confOut["con"].escapeId(confIn["db"]["database"]));
    await mysqlChangeDatabase(confOut["con"], cutEdges(confOut["con"].escapeId(confIn["db"]["database"])));
    
    //check email
    if (typeof confIn["email"] === "object" && typeof confIn["email"]["smtp"] === "object") {
        const fields = ["host", "user", "pass", "from", "name"];
        //check input
        for (const key of fields) {
            if (typeof confIn["email"]["smtp"][key] !== "string") {
                throw new Error("Wrong email " + key + " format!");
            }
        }
        if (typeof confIn["email"]["smtp"]["port"] !== "number" || Number.isInteger(confIn["email"]["smtp"]["port"]) || confIn["email"]["smtp"]["port"] < 0) {
            throw new Error("Wrong email port number!");
        }
        
        //check connection
        const connection = nodemailer.createTransport({
            "host": confIn["email"]["smtp"]["host"],
            "port": confIn["email"]["smtp"]["port"],
            "secure": confIn["email"]["smtp"]["port"] === 465, // true for 465, false for other ports
            "tls": {
                "rejectUnauthorized": true
            },
            "requireTLS": true,
            "auth": {
                "user": confIn["email"]["smtp"]["user"],
                "pass": confIn["email"]["smtp"]["pass"]
            },
            "pool": false
        });
        try {
            await connection.verify();
        } catch (error) {
            throw new Error("Falied to connect SMTP server");
        }
        //copy conf
        confOut["email"] = {};
        confOut["email"]["smtp"] = {};
        for (const key of fields) {
            confOut["email"]["smtp"][key] = confIn["email"]["smtp"][key];
        }
        confOut["email"]["smtp"]["port"] = confIn["email"]["smtp"]["port"];
        //check allowRegister (optional)
        if (typeof confIn["email"]["allowRegister"] !== "boolean") {
            confIn["email"]["allowRegister"] = true;
        }
        confOut["email"]["allowRegister"] = confIn["email"]["allowRegister"];
        
    }
    
    //check allowSameEmail (optional)
    if (typeof confIn["allowSameEmail"] !== "boolean") {
        confIn["allowSameEmail"] = false;
    }
    confOut["allowSameEmail"] = confIn["allowSameEmail"];
    
    
    //check and select users
    confOut["users"] = [];
    if (confIn["users"] instanceof Array) {
        for (const user of confIn["users"]) {
            if (typeof user === "object" && typeof user["username"] === "string" && typeof user["pass"] === "string") {
                const userOut = {};

                userOut["username"] = user["username"];
                userOut["pass"] = user["pass"];

                //check email
                if (typeof user["email"] === "string") {
                    userOut["email"] = user["email"];
                } else {
                    userOut["email"] = "";
                }
                
                //check isAdmin
                userOut["isAdmin"] = (user?.["isAdmin"] === true);
                
                confOut["users"].push(userOut);
            }
        }
    }
    
    return confOut;
    
    
    
    
    
    
    /*

    output configuration:
        {
            "port": 443,
            "https": {                 //optional
                "key": "FILEDATA",
		        "cert": "FILEDATA",
		        "redirectFrom": 80     //optional
            },
            "con": "mysqlConnection,
            "email": {               // optional
                "smtp": {
                    "host": "smtp.outlook.com",
                    "port": 465,
                    "user": "user@email.com",
                    "pass": "Password123",
                    "from": "user@email.com",
                    "name": "Administrator"
                },
                "allowRegister": true
            },
            "allowSameEmail": false,
            "users": [
                {
                    "email":"email@email.com",
                    "username":"admin",
                    "pass":"admin",
                    "isAdmin":true
                }
            ]
        }
    */
    
};


// Runtime (in memory storage for websocket and for business logic)
const Runtime = class {
    clients = new Map();
    sessions = new Map();
    users = new Map();
    rooms = new Map();
    expires = [];
    /*
        Clients
            clientID: {
                "ws": ws,
                "sessionID": 123,
                "rooms": Set([roomID1, roomID2])
            }
        Sessions    Session 1-N Clients
            sessionID: {
                "clients": Set([clientID1, clientID2]),
                "userID": 1234
            }
        Users    Users 1-N Sessions
            userID: {
                "isGuest": false,
                "name": "asd"
                "sessions": Set([sessionID1, sessionID2])
            }
        Rooms    Rooms N-N Clients
            RoomID: {
                "name": "Room name",
                "users": Set([clientID1, clientID2])
            }

        Expires
            Ordered array {
                "expire": 23000
                "type": "client|session|user|room"
            }
            
    */
    con; // mysql connection
    TBL_VERIFY = "verifications";
    TBL_USERS = "users";
    TBL_ADMINS = "admins";
    TBL_DELETE = "delete";
    TBL_SESSIONS = "sessions";
    TBL_RESOURCES = "resources";
    TBL_PERMISSIONS = "permissions";
    constructor() {

    };
    /**
     * Start the runtime
     * @param {Object} conf - configuration object
     * @returns {Object<Promise<undefined>>}
     */
    async start(conf) {
        this.con = conf["con"];
        const userTable = await mysqlQuery(this.con, `
            SELECT \`TABLE_NAME\` FROM \`INFORMATION_SCHEMA\`.\`TABLES\`
            WHERE \`TABLE_SCHEMA\` = 'desktop_streamer' AND \`TABLE_NAME\` = `+ this.con.escape(this.TBL_USERS) +`
        `);
        const isFirstStart = userTable.length === 0;

        // Create database schema
        await mysqlQuery(this.con, `
            CREATE TABLE IF NOT EXISTS ` + this.con.escapeId(this.TBL_VERIFY) + ` (
                \`verification_id\` INT(11) NOT NULL,
                \`email\` VARCHAR(255) NOT NULL,
                \`code_email\` VARCHAR(255) NOT NULL,
                \`code_local\` VARCHAR(255) NOT NULL,
                \`expire\` TIMESTAMP NOT NULL,
                PRIMARY KEY(\`verification_id\`)
            );
        `);
        await mysqlQuery(this.con, `
            CREATE TABLE IF NOT EXISTS ` + this.con.escapeId(this.TBL_USERS) + ` (
                \`user_id\` INT(11) NOT NULL,
                \`email\` VARCHAR(255) NOT NULL,
                \`username\` VARCHAR(255) NOT NULL,
                \`password\` VARCHAR(255) NOT NULL,
                PRIMARY KEY(\`user_id\`)
            );
        `);
        await mysqlQuery(this.con, `
            CREATE TABLE IF NOT EXISTS ` + this.con.escapeId(this.TBL_ADMINS) + ` (
                \`user_id\` INT(11) NOT NULL,
                PRIMARY KEY(\`user_id\`),
                FOREIGN KEY(\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON UPDATE CASCADE ON DELETE CASCADE
            );
        `);
        await mysqlQuery(this.con, `
            CREATE TABLE IF NOT EXISTS ` + this.con.escapeId(this.TBL_DELETE) + ` (
                \`user_id\` INT(11) NOT NULL,
                \`expire\` TIMESTAMP NULL DEFAULT NULL,
                PRIMARY KEY(\`user_id\`),
                FOREIGN KEY(\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON UPDATE CASCADE ON DELETE CASCADE
            );
        `);
        await mysqlQuery(this.con, `
            CREATE TABLE IF NOT EXISTS ` + this.con.escapeId(this.TBL_SESSIONS) + ` (
                \`session_pk\` INT(11) NOT NULL,
                \`session_id\` INT(11) NOT NULL,
                \`user_id\` INT(11) NOT NULL,
                \`last_login\` TIMESTAMP NULL DEFAULT NULL,
                \`last_ip\` VARCHAR(255) NULL,
                \`expire\` TIMESTAMP NULL DEFAULT NULL,
                \`is_recovery\` TINYINT(1) NOT NULL,
                \`recovery_email\` VARCHAR(255) NOT NULL,
                PRIMARY KEY(\`session_pk\`),
                FOREIGN KEY(\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON UPDATE CASCADE ON DELETE CASCADE
            );
        `);
        await mysqlQuery(this.con, `
            CREATE TABLE IF NOT EXISTS ` + this.con.escapeId(this.TBL_RESOURCES) + ` (
                \`resource_id\` INT(11) NOT NULL,
                \`parent_resource_id\` INT(11) NULL,
                \`name\` VARCHAR(255) NOT NULL,
                \`is_room\` TINYINT(1) NOT NULL,
                \`is_open\` TINYINT(1) NOT NULL,
                PRIMARY KEY(\`resource_id\`)
            );
        `);
        await mysqlQuery(this.con, `
            CREATE TABLE IF NOT EXISTS ` + this.con.escapeId(this.TBL_PERMISSIONS) + ` (
                \`permission_id\` INT(11) NOT NULL,
                \`resource_id\` INT(11) NOT NULL,
                \`user_id\` INT(11) NOT NULL,
                \`permission\` TINYINT(1) NOT NULL,
                PRIMARY KEY(\`permission_id\`),
                FOREIGN KEY(\`resource_id\`) REFERENCES \`resources\`(\`resource_id\`) ON UPDATE CASCADE ON DELETE CASCADE,
                FOREIGN KEY(\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON UPDATE CASCADE ON DELETE CASCADE
            );
        `);

        for (const user of conf["users"]) {
            
        }
    };
    /**
     * Clean unused data from Database and Memory
     * @returns {Object<Promise<undefined>>}
     */
    async dbClean() {

    };
    
    /**
     * Generate random unique ID
     * @param {Object<Map>} memory - memory to search ID, null if not need to check
     * @param {string} table - table name to search, empty string if not need to check
     * @param {string} col - column where search, empty string if not need to check
     * @returns {Object<Promise<number>>}
     */
    async genID(memory=null, table="", col="") {
        let id;
        let isExist = false;
        do {
            id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER - 1) + 1;
            if (memory !== null) {
                isExist = memory.has(id);
            }
            if (table !== "" && col !== "" && isExist === false) {
                isExist = await mysqlCheckExist(this.con, table, col, id);
            }
        } while (isExist);
        return id;
    };

    async handleAPI(data) {
        /*
            Client: [
                123,                // callback id
                0:                  // method 0-ping 1-login 2-logout, 3-switch-to-main, 4-switch-to-room
                // data
                    Login
                    [
                        0,                  // type: 0-guest login 1-session login 2-password login
                        "",                 // guest name or sessionID or username
                        "",                 // user password, only for password login
                    ]
                    Logout
                    [
                        123                 //session code
                    ]
                    
            ]

            

            Server: [
                123,                // callback id
                0,                  // status 0-everything is good,  400 - worng JSON syntax; 404 wrong api request, only if has error
                [                   // data if no error
                    
                ]
            ]
        */
        const answer = [0, 0];

        // handle syntax errors
        try {
            data = JSON.parse(data);
        } catch (error) {
            answer[0] = 0;
            answer[1] = 400;
            return answer;
        }
        if ((data instanceof Array) === false || data.length < 2) {
            answer[0] = 0;
            answer[1] = 400;
            return answer;
        }

        //search for API
        answer[0] = data[0];
        answer[1] = 0;
        if (data[1] === 0) {

        } else if (data[1] === 1) {

        } else {
            answer[1] = 404;
        }
        return answer;
    };
    //
    // clients functions
    //
    // client connect and handle API
    async clientCreate(ws) {
        // generate clientID
        const clientID = await this.genID(this.clients, "", "");
        console.log("Client connected (" + clientID + ")");
        this.clients.set(clientID, {
            "ws": ws,
            "sessionID": 0,
            "rooms": new Set()
        })
        
        // listen API messages
        ws.addListener("message", async (data) => {
            console.log("received: %s", data);
            const answer = await this.handleAPI(data);
            if (typeof answer !== "undefined") {
                ws.send(JSON.stringify(answer));
            }
        });

        // listen error
        ws.addListener("error", (err) => {
            console.log("Error " + err);
        });

        // listen close
        ws.addEventListener("close", () => {
            console.log("Client disconnected (" + clientID + ")");
            this.clientDestroy(clientID);
        });
    };
    clientDestroy(clientID) {

    };
    clientLogin(type) {
        //guest login || login with session || login with password

    };
    clientLogout(type) {
        //guest login || login with session || login with password

    };
    clientLogout() {

    }

    // User function
    registerUser() {

    }

    // room functions
    roomCreate() {
        
    };
    roomDestroy(roomID) {
        
    };

    clientJoinRoom(clientID, roomID, isHost=false, isRequestJoin=false) {
        
    };
    clientLeaveRoom(clientID, roomID) {
        
    };
};


// Static HTTP file server
const getFileData = async function(src) {
    try {
        const data = await fs.readFile(src);
        const stats = await fs.stat(src);
        const date = new Date(stats.mtimeMs);
        return {
            "lastModified": date.toUTCString(),
            "type": mime.getMIMEType(path.extname(src)),
            "size": stats.size,
            "buffer": data
        };
    } catch (error) {
        return undefined;
    }
    
};
const getFileDataStream = async function(src) {
    try {
        const stats = await fs.stat(src);
        if (stats.isFile() === false) {
            return undefined;
        }

        const data = await fs.open(src);
        const date = new Date(stats.mtimeMs);
        return {
            "lastModified": date.toUTCString(),
            "type": mime.getMIMEType(path.extname(src)),
            "size": stats.size,
            "stream": data.createReadStream()
        };
    } catch (error) {
        return undefined;
    }
};
const generateClient = async function(srcUI, srcElectron, dest) {
    //goes through along UI element
    const cacheUI = new Map();
    const entriesUI = await fs.readdir(srcUI, { "recursive": true });

    //get static files data
    for (const enrty of entriesUI) {
        const fullPath = path.join(srcUI, enrty);
        const enrtyStat = await fs.stat(fullPath);
        if (enrtyStat.isFile() && path.relative(dest, fullPath).startsWith("..")) {
            const data = await getFileData(fullPath);
            cacheUI.set(enrty.replaceAll("\\", "/"), data);
        }
    }
    //console.log(cacheUI);
    

    //goes through along Electron elements
    const enviroments = ["electron-win32-x64.zip"];
    const cacheConf = new Map();
    const entriesConf = await fs.readdir(srcElectron, { "recursive": true });

    //get static files data
    for (const enrty of entriesConf) {
        const fullPath = path.join(srcElectron, enrty);
        const enrtyStat = await fs.stat(fullPath);
        if (enrtyStat.isFile() && enviroments.includes(enrty) === false) {
            const data = await getFileData(fullPath);
            cacheConf.set(enrty.replaceAll("\\", "/"), data);
        }
    }
    //console.log(cacheConf);

    //loop over electron platforms
    await fs.mkdir(dest, { "recursive": true });
    for (const enrty of enviroments) {
        const fullPath = path.join(srcElectron, enrty);
        //load exist zip
        const fileBuffer = await fs.readFile(fullPath);
        const zip = new JSZip();
        await zip.loadAsync(fileBuffer);

        //modify
        const pathUI = "resources/app/ui/";
        const cacheUIIt = cacheUI[Symbol.iterator]();
        for (const [file, content] of cacheUIIt) {
            zip.file(pathUI+file, content["buffer"]);
        }

        const pathConf = "resources/app/";
        const cacheConfIt = cacheConf[Symbol.iterator]();
        for (const [file, content] of cacheConfIt) {
            zip.file(pathConf+file, content["buffer"]);
        }

        //save
        const contentBuffer = await zip.generateAsync({"type":"nodebuffer"});
        await fs.writeFile(path.join(dest, enrty), contentBuffer);
    }

};
const generateCache = async function(src, ignore) {
    const cache = new Map();
    
    //goes through along all element
    const entries = await fs.readdir(src, { "recursive": true });
    
    //get files data and type
    for (const enrty of entries) {
        const fullPath = path.join(src, enrty);
        const enrtyStat = await fs.stat(fullPath);
        const isChild = ignore.some(function (el) {
            return path.relative(el, fullPath).startsWith("..") === false;
        });
        if (enrtyStat.isFile() && isChild === false) {
            const data = await getFileData(fullPath);
            cache.set(enrty.replaceAll("\\", "/"), data);
        }
    }
    return cache;
};
const getFile = async function(basePath, filePath, cache) {
    let fileData = cache.get(filePath); // cache get
    if (typeof fileData === "undefined") {
        fileData = await getFileDataStream(path.join(basePath, filePath)); // fresh get
    }
    return fileData;
};
const HTTPServerStart = async function(conf) {
    let servers = [];
    const basePath = "../client/ui";
    const tmpPath = "../client/ui/tmp";
    const electronPath = "../client/electron";

    //Generate desktop client zips
    //await generateClient(basePath, electronPath, tmpPath);

    //Cache UI pages
    let fileCache = new Map();
    //fileCache = await generateCache(basePath, [tmpPath]);
    
    // file listening function
    const requestHandle = async function(req, res) {
        const filePath = req.url.slice(1);

        let fileData = await getFile(basePath, filePath, fileCache); // get requested
        if (typeof fileData === "undefined") {
            fileData = await getFile(basePath, "index.html", fileCache); // get default
        }

        res.writeHead(200, {
            //"Content-Security-Policy": "default-src 'self'",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Last-Modified": fileData["lastModified"],
            "Content-Length": fileData["size"],
            "Content-Type": fileData["type"]
        });

        if (typeof fileData["stream"] !== "undefined") {
            fileData["stream"].pipe(res);
        } else {
            res.write(fileData["buffer"]);
            res.end(); //end the response
        }
    };

    // redirect function
    const redirectHandle = function(req, res) {
        const myURL = req.headers.host.split(":")[0];
        const myPort = conf["port"] !== 443 ? ":" + conf["port"] : "";
        res.writeHead(302, {
            "Location": "https://" + myURL + myPort + req.url
        });
        res.end();
    };

    //create HTTP or HTTPS server
    if (typeof conf["https"] !== "undefined") {
        const options = {
            "key": conf["https"]["key"],
            "cert": conf["https"]["cert"]
        };
        const server = https.createServer(options, requestHandle).listen(conf["port"]);
        servers.push(server);

        if (typeof conf["https"]["redirectFrom"] === "number") {
            const serverRedirect = http.createServer(options, redirectHandle).listen(conf["https"]["redirectFrom"]);
            servers.push(serverRedirect);
        }
        
    } else {
        const server = http.createServer(requestHandle).listen(conf["port"]);
        servers.push(server);
    }
    return servers;
};
const HTTPServerStop = async function(servers) {
    for (const server of servers) {
        await new Promise(function(resolve) {
            server.close(function() {
                resolve(true);
            });
        });
    }
};


// Websocket server
const wsServerStart = async function(HTTPserver, runtime) {
    const wsServer = new ws.WebSocketServer({
        "server": HTTPserver
    });
    wsServer.addListener("connection", function(ws) {
        runtime.clientCreate(ws);
    });
    return wsServer;
};
const wsServerStop = async function(ws) {
    return new Promise(function(resolve) {
        let round = 0;
        const close = function() {
            if (round === 0) {
                // First sweep, soft close
                ws.clients.forEach(function (socket) {
                    socket.close();
                });
            } else if (round < 50) {
                // Check clients
                let isAllClosed = true;
                for (const socket of ws.clients) {
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
                ws.clients.forEach(function(socket) {
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
};


// Close the server
let isClosing = false;
const close = async function(con, HTTPservers, ws) {
    if (isClosing) {
        return;
    }
    isClosing = true;

    console.log("Closing Websocket server...");
    await wsServerStop(ws);

    console.log("Closing HTTP servers...");
    await HTTPServerStop(HTTPservers);

    console.log("Closing database...");
    await mysqlClose(con);

    isClosing = false;
};


//Main funtion
const main = async function(args) {
    // Read CLI options
    console.log("Load arguments...");
    const confPath = getArg(args, "--configuration=", "conf/conf.json");
    
    // Load configuration
    console.log("Run initial setup...");
    const conf = await initialSetup(confPath);

    // Create runtime
    console.log("Create runtime...");
    const runtime = new Runtime();
    await runtime.start(conf);
    
    // Start HTTP server
    console.log("Start HTTP server...");
    const HTTPservers = await HTTPServerStart(conf);
    
    // Start WS server
    console.log("Start Websocket server...");
    const ws = await wsServerStart(HTTPservers[0], runtime);
    
    // Cleanup
    console.log("Press CTRL+C to stop servers");
    process.on("SIGTERM", async function() {
        console.log("SIGTERM signal received.");
        // Perform cleanup tasks here
        await close(conf["con"], HTTPservers, ws);
    });
    process.on("SIGINT", async function() {
        console.log("SIGINT signal received.");
        // Perform cleanup tasks here
        await close(conf["con"], HTTPservers, ws);
    });
};
main(process.argv);