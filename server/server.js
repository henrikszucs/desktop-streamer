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

const mysql = require("mysql");
const ws = require("ws");
const nodemailer = require("nodemailer");
const { stat } = require("node:fs");



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



// MySQL general functions
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
    return new Promise(async function(resolve) {
        const changeObj = {
            "database" : cutEdges(con.escapeId(dbName))
        };
        con.changeUser(changeObj, function(err) {
            if (err) {
                resolve(false);
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
const checkExist = async function(con, table, col, val) {
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
/**
 * Generate random unique ID in table cols
 * @param {Object<Sqlite3>} db - Database access
 * @param {string} table - table name to search
 * @param {string} col - column where search
 * @returns {Object<Promise<number>>}
 */
const genID = async function(con, table, col) {
    let id;
    let isExist = false;
    do {
        id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER - 1) + 1;
        isExist = await checkExist(con, table, col, id);
    } while (isExist);
    return id;
};





/**
 * Clean unused data from Database
 * @param {Object<Sqlite3>} db - Database access
 * @returns {Object<Promise<undefined>>}
 */
const dbClean = async function(db) {

};

/**
 * Check email verification code
 * @param {Object<Sqlite3>} db - Database access
 * @param {string} email - Email to verify
 * @param {string} code_email - Verify code from email
 * @param {string} code_local - Verify code from local machine
 * @returns {Object<Promise<boolean>>}
 */
const isEmailVerified = async function(db, email, code_email, code_local) {

};

/**
 * Add an user to database (not check input)
 * @param {Object<Sqlite3>} db - Database access
 * @param {string} email - Email of the user (can be empty)
 * @param {string} username - Username of the user (can be empty)
 * @param {string} pass - password of the user (can be empty)
 * @param {boolean} allowSameEmail - policy of the email handling
 * @returns {Object<Promise<number>>}
 */
const userAdd = async function(db, email, username, pass, allowSameEmail) {
    
};
const userModify = function(db) {
    
};
const userDelete = function(db) {
    
};




//global configuration parse
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
    confOut["con"] = await mysqlConnect(mysql, {
        "host": confIn["db"]["host"],
        "port": confIn["db"]["port"],
        "user": confIn["db"]["user"],
        "password": confIn["db"]["pass"]
    });
    //check database
    await mysqlQuery(confOut["con"], "CREATE DATABASE IF NOT EXISTS  " + confOut["con"].escapeId(confIn["db"]["database"]));
    await mysqlChangeDatabase(confOut["con"], cutEdges(confOut["con"].escapeId(confIn["db"]["database"])));
    const userTable = await mysqlQuery(confOut["con"], `
        SELECT \`TABLE_NAME\` FROM \`INFORMATION_SCHEMA\`.\`TABLES\`
        WHERE \`TABLE_SCHEMA\` = 'desktop_streamer' AND \`TABLE_NAME\` = 'users'
    `);
    const isFirstStart = userTable.length === 0;

    await mysqlQuery(confOut["con"], `
        CREATE TABLE IF NOT EXISTS \`verifications\` (
            \`verification_id\` INT(11) NOT NULL,
            \`email\` VARCHAR(255) NOT NULL,
            \`code_email\` VARCHAR(255) NOT NULL,
            \`code_local\` VARCHAR(255) NOT NULL,
            \`expire\` TIMESTAMP NOT NULL,
            PRIMARY KEY(\`verification_id\`)
        );
    `);
    await mysqlQuery(confOut["con"], `
        CREATE TABLE IF NOT EXISTS \`users\` (
            \`user_id\` INT(11) NOT NULL,
            \`email\` VARCHAR(255) NOT NULL,
            \`username\` VARCHAR(255) NOT NULL,
            \`password\` VARCHAR(255) NOT NULL,
            PRIMARY KEY(\`user_id\`)
        );
    `);
    await mysqlQuery(confOut["con"], `
        CREATE TABLE IF NOT EXISTS \`admins\` (
            \`user_id\` INT(11) NOT NULL,
            PRIMARY KEY(\`user_id\`),
            FOREIGN KEY(\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON UPDATE CASCADE ON DELETE CASCADE
        );
    `);
    await mysqlQuery(confOut["con"], `
        CREATE TABLE IF NOT EXISTS \`delete\` (
            \`user_id\` INT(11) NOT NULL,
            \`expire\` TIMESTAMP NULL DEFAULT NULL,
            PRIMARY KEY(\`user_id\`),
            FOREIGN KEY(\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON UPDATE CASCADE ON DELETE CASCADE
        );
    `);
    await mysqlQuery(confOut["con"], `
        CREATE TABLE IF NOT EXISTS \`sessions\` (
            \`session_id\` INT(11) NOT NULL,
            \`user_id\` INT(11) NOT NULL,
            \`last_login\` TIMESTAMP NULL DEFAULT NULL,
            \`last_ip\` VARCHAR(255) NULL,
            \`expire\` TIMESTAMP NULL DEFAULT NULL,
            \`is_recovery\` TINYINT(1) NOT NULL,
            \`recovery_email\` VARCHAR(255) NOT NULL,
            PRIMARY KEY(\`session_id\`),
            FOREIGN KEY(\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON UPDATE CASCADE ON DELETE CASCADE
        );
    `);
    await mysqlQuery(confOut["con"], `
        CREATE TABLE IF NOT EXISTS \`resources\` (
            \`resource_id\` INT(11) NOT NULL,
            \`parent_resource_id\` INT(11) NULL,
            \`name\` VARCHAR(255) NOT NULL,
            \`is_room\` TINYINT(1) NOT NULL,
            \`is_open\` TINYINT(1) NOT NULL,
            PRIMARY KEY(\`resource_id\`)
        );
    `);
    await mysqlQuery(confOut["con"], `
        CREATE TABLE IF NOT EXISTS \`permissions\` (
            \`permission_id\` INT(11) NOT NULL,
            \`resource_id\` INT(11) NOT NULL,
            \`user_id\` INT(11) NOT NULL,
            \`permission\` TINYINT(1) NOT NULL,
            PRIMARY KEY(\`permission_id\`),
            FOREIGN KEY(\`resource_id\`) REFERENCES \`resources\`(\`resource_id\`) ON UPDATE CASCADE ON DELETE CASCADE,
            FOREIGN KEY(\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON UPDATE CASCADE ON DELETE CASCADE
        );
    `);
    
    //check email
    if (typeof confIn["email"] === "object" && typeof confIn["email"]["smtp"] === "object") {
        let isCorrect = true;
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
        let result = false;
        try {
            result = await connection.verify();
        } catch (error) {
            throw new Error("Falied to connect SMTP server");
        }
        isCorrect = result;
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
    
    
    //check and create users
    if (isFirstStart && confIn["users"] instanceof Array) {
        for (const user of confIn["users"]) {
            if (typeof user === "object" && typeof user["username"] === "string" && typeof user["pass"] === "string") {
                let isCorrect = true;
                //check email
                if (typeof user["email"] === "string") {
                    const hasEmail = await checkExist(confOut["con"], "users", "email", user["email"]);
                    if (confOut["allowSameEmail"] === false && hasEmail === true) {
                        isCorrect = false;
                        console.log("Skip user (" + user["username"] + ") - not allowed duplicated emails (" + user["email"] + ")");
                    }
                } else {
                    user["email"] = "";
                }
                
                //check username
                if (isCorrect) {
                    const hasUsename = await checkExist(confOut["con"], "users", "username", user["username"]);
                    if (hasUsename === true) {
                        isCorrect = false;
                        console.log("Skip user (" + user["username"] + ") - not allowed duplicated username");
                    }
                }
                
                //add user
                if (isCorrect) {
                    let id = await genID(confOut["con"], "users", "user_id");
                    id = confOut["con"].escape(id);
                    let email = confOut["con"].escape(user["email"]);
                    let username = confOut["con"].escape(user["username"]);
                    let pass = confOut["con"].escape(crypto.createHash("sha256").update(user["pass"]).digest("hex"));
                    await mysqlQuery(confOut["con"], `
                        INSERT INTO \`users\` (\`user_id\`, \`email\`, \`username\`, \`password\`)
                        VALUES (
                            ` + id + `,
                            ` + email + `,
                            ` + username + `,
                            ` + pass + `
                        );
                    `);
                    if (user?.["isAdmin"] === true) {
                        await mysqlQuery(confOut["con"], `
                            INSERT INTO \`admins\` (\`user_id\`)
                            VALUES (
                                '` + id + `'
                            );
                        `);
                    }
                }
                
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
            "allowSameEmail": false
        }
    */
    
};


//static HTTP server
const getFileData = async function(src) {
    try {
        const data = await fs.readFile(src);
        const date = new Date(stat.mtimeMs);
        return {
            "lastModified": date.toUTCString(),
            "type": mime.getMIMEType(path.extname(src)),
            "buffer": data
        };
    } catch (error) {
        return undefined;
    }
    
};
const generateCache = async function(src) {
    const cache = new Map();
    
    //goes through along all element
    const entries = await fs.readdir(src, { "recursive": true });
    
    //get files data and type
    for (const enrty of entries) {
        const fullPath = path.join(src, enrty);
        const enrtyStat = await fs.stat(fullPath);
        if (enrtyStat.isFile()) {
            const data = await getFileData(fullPath);
            cache.set(enrty.replaceAll("\\", "/"), data);
        }
    }
    return cache;
};
const HTTPServerStart = async function(conf) {
    let servers = [];
    //Cache UI pages
    const fileCache = await generateCache("ui/");
    
    //listening function
    const requestHandle = async function(req, res) {
        const filePath = req.url.slice(1);
        //let fileData = fileCache.get(filePath); // cache get
        let fileData = await getFileData(path.join("ui", filePath)); // fresh get
        if (typeof fileData === "undefined") {
            //fileData = fileCache.get("index.html"); // cache get
            fileData = await getFileData(path.join("ui", "index.html")); // fresh get
        }
        
        res.writeHead(200, {
            "Last-Modified": fileData["lastModified"],
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Length": Buffer.byteLength(fileData["buffer"]),
            "Content-Type": fileData["type"]
        });
        res.write(fileData["buffer"]);
        res.end(); //end the response
    };
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


// Websocket servers
const wsServerStart = async function(HTTPserver) {
    const wsServer = new ws.WebSocketServer({
        "server": HTTPserver
    });
    wsServer.on("connection", function(ws) {
        console.log("Client connected");
        console.log(ws);
        ws.on("error", function(err) {
            console.log("Error " + err);
        });
      
        ws.on("message", function(data) {
            console.log("received: %s", data);
        });
      
        //ws.send("something");
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


// Close the backend
const close = async function(con, HTTPservers, ws) {
    console.log("Closing database...");
    await mysqlClose(con);

    console.log("Closing HTTP servers...");
    await HTTPServerStop(HTTPservers);

    console.log("Closing Websocket server...");
    await wsServerStop(ws);
};


//Main funtion
const main = async function(args) {
    //read CLI options
    console.log("Load arguments...");
    const confPath = getArg(args, "--configuration=", "conf/conf.json");
    
    //Load configuration
    console.log("Run initial setup...");
    const conf = await initialSetup(confPath);
    
    //Start HTTP server
    console.log("Start HTTP server...");
    const HTTPservers = await HTTPServerStart(conf);
    
    //Start WS server
    console.log("Start Websocket server...");
    const ws = await wsServerStart(HTTPservers[0]);
    
    //cleanup
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