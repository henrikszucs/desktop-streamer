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

const sqlite3 = require("sqlite3");
const ws = require("ws");
const nodemailer = require("nodemailer");
const { stat } = require("node:fs");




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


/**
 * Escape SQL text's (note: not satisfied with original one)
 * @param {string} str - String to escape
 * @returns {string}
 */
const mysqlRealEscapeString = function(str) {
    str = String(str);
    return str.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function(char) {
        switch (char) {
            case "\0":
                return "\\0";
            case "\x08":
                return "\\b";
            case "\x09":
                return "\\t";
            case "\x1a":
                return "\\z";
            case "\n":
                return "\\n";
            case "\r":
                return "\\r";
            case "\"":
            case "'":
            case "\\":
            case "%":
                return "\\" + char; // prepends a backslash to backslash, percent,
                // and double/single quotes
            default:
                return char;
        }
    });
};
/**
 * Promisify verion of sqlite3 API
 * @param {Object<Sqlite3>} db - Database access
 * @param {string} query - SQL query
 * @returns {Object<Promise<Array>>}
 */
const mysqlQuery = async function(db, query) {
    return new Promise(function(resolve, reject) {
        db.all(query, function(error, rows) {
            if (error !== null) {
                reject(error);
            }
            resolve(rows);
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
const checkExist = async function(db, table, col, val) {
    const res = await mysqlQuery(db, `
        SELECT \`` + mysqlRealEscapeString(col) + `\`
        FROM \`` + mysqlRealEscapeString(table) + `\`
        WHERE \`` + mysqlRealEscapeString(col) + `\` = '` + mysqlRealEscapeString(val) + `'
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
const genID = async function(db, table, col) {
    let id;
    let isExist = false;
    do {
        id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER - 1) + 1;
        isExist = await checkExist(db, table, col, id);
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


//global configuration (with default value)
const initialSetup = async function(confPath) {
    let confIn = {};
    let confOut = {};
    
    //check if conf file exist
    try {
        const contents = await fs.readFile(confPath, {
            "encoding": "utf8"
        });
        confIn = JSON.parse(contents);
        if (!(confIn instanceof Object)) {
            confIn = {};
        }
    } catch (error) {
        console.error("Error in configuration read:" + error + " (use default conf)");
    }
    
    //this will convert path if relative to configuration file
    const confPathToAbsolute = function(src) {
        if (path.isAbsolute(src) === false) {
            src = path.join(process.cwd(), path.dirname(confPath), src);
        }
        return path.resolve(src);
    };
    
    //check port value
    if (typeof confIn["port"] !== "number") {
        confIn["port"] = 8888;
    }
    confOut["port"] = parseInt(confIn["port"]);
    
    //check key and cert
    if (typeof confIn["https"] === "object" && typeof confIn["https"]["key"] === "string" && typeof confIn["https"]["cert"] === "string") {
        confIn["https"]["key"] = confPathToAbsolute(confIn["https"]["key"]);
        confIn["https"]["cert"] = confPathToAbsolute(confIn["https"]["cert"]);
        try {
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
            if (typeof confIn["https"]["redirectFrom"] === "number" && confOut["port"] !== confIn["https"]["redirectFrom"]) {
                confOut["https"]["redirectFrom"] = confIn["https"]["redirectFrom"];
            }
        } catch (error) {
            console.error("Error in cert and key read:" + error + " (use HTTP)");
        }
    }
    
    //check and create database
    if (typeof confIn["db"] !== "string") {
        confIn["db"] = "database.db";
    }
    confIn["db"] = confPathToAbsolute(confIn["db"]);
    await fs.mkdir(path.dirname(confIn["db"]), {
        "recursive": true
    });
    const isFirstStart = await new Promise(async function(resolve) {
        try {
            await fs.access(confIn["db"], fs.constants.R_OK | fs.constants.W_OK);
            console.log("Load existing db");
            resolve(false);
        } catch (error) {
            console.log("Create new db");
            resolve(true);
        }
        
    });
    confOut["db"] = await new Promise(function(resolve) {
        new sqlite3.Database(confIn["db"], function(error) {
            if (error !== null) {
                console.error("Failed to open database!");
            }
            resolve(this);
        });
    });
    await mysqlQuery(confOut["db"], `
        CREATE TABLE IF NOT EXISTS \`verifications\` (
            \`verification_id\` INT(11) NOT NULL,
            \`email\` VARCHAR(255) NOT NULL,
            \`code_email\` VARCHAR(255) NOT NULL,
            \`code_local\` VARCHAR(255) NOT NULL,
            \`expire\` TIMESTAMP NOT NULL,
            PRIMARY KEY(\`verification_id\`)
        );
    `);
    await mysqlQuery(confOut["db"], `
        CREATE TABLE IF NOT EXISTS \`users\` (
            \`user_id\` INT(11) NOT NULL,
            \`email\` VARCHAR(255) NOT NULL,
            \`username\` VARCHAR(255) NOT NULL,
            \`password\` VARCHAR(255) NOT NULL,
            PRIMARY KEY(\`user_id\`)
        );
    `);
    await mysqlQuery(confOut["db"], `
        CREATE TABLE IF NOT EXISTS \`admins\` (
            \`user_id\` INT(11) NOT NULL,
            PRIMARY KEY(\`user_id\`),
            FOREIGN KEY(\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON UPDATE CASCADE ON DELETE CASCADE
        );
    `);
    await mysqlQuery(confOut["db"], `
        CREATE TABLE IF NOT EXISTS \`delete\` (
            \`user_id\` INT(11) NOT NULL,
            \`expire\` TIMESTAMP NOT NULL,
            PRIMARY KEY(\`user_id\`)
        );
    `);
    await mysqlQuery(confOut["db"], `
        CREATE TABLE IF NOT EXISTS \`sessions\` (
            \`session_id\` INT(11) NOT NULL,
            \`user_id\` INT(11) NOT NULL,
            \`last_login\` TIMESTAMP NOT NULL,
            \`last_ip\` VARCHAR(255) NULL,
            \`expire\` TIMESTAMP NOT NULL,
            \`is_recovery\` TINYINT(1) NOT NULL,
            \`recovery_email\` VARCHAR(255) NOT NULL,
            PRIMARY KEY(\`session_id\`),
            FOREIGN KEY(\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON UPDATE CASCADE ON DELETE CASCADE
        );
    `);
    await mysqlQuery(confOut["db"], `
        CREATE TABLE IF NOT EXISTS \`resources\` (
            \`resource_id\` INT(11) NOT NULL,
            \`parent_resource_id\` INT(11) NULL,
            \`name\` VARCHAR(255) NOT NULL,
            \`is_room\` TINYINT(1) NOT NULL,
            \`is_open\` TINYINT(1) NOT NULL,
            PRIMARY KEY(\`resource_id\`)
        );
    `);
    await mysqlQuery(confOut["db"], `
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
    if (confIn["email"] instanceof Object && confIn["email"]["smtp"] instanceof Object) {
        let isCorrect = true;
        const fields = ["host", "user", "pass", "from", "name"];
        //check input
        for (const key of fields) {
            if (typeof confIn["email"]["smtp"][key] !== "string") {
                isCorrect = false;
                break
            }
        }
        if (typeof confIn["email"]["smtp"]["port"] !== "number") {
            isCorrect = false;
        } else {
            confIn["email"]["smtp"]["port"] = parseInt(confIn["email"]["smtp"]["port"]);
        }
        
        //check connection
        if (isCorrect) {
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
                
            }
            if (result === false) {
                console.log("Falied to connect SMTP server");
            }
            isCorrect = result;
        }
        //copy conf
        if (isCorrect) {
            confOut["email"] = {};
            confOut["email"]["smtp"] = {};
            //copy smtp
            for (const key of fields) {
                confOut["email"]["smtp"][key] = confIn["email"]["smtp"][key];
            }
            //copy allowRegister
            if (typeof confIn["email"]["allowRegister"] !== "boolean") {
                confIn["email"]["allowRegister"] = true;
            }
            confOut["email"]["allowRegister"] = confIn["email"]["allowRegister"];
            
        }
    }
    
    //check allowSameEmail
    if (typeof confIn["allowSameEmail"] !== "boolean") {
        confIn["allowSameEmail"] = false;
    }
    confOut["allowSameEmail"] = confIn["allowSameEmail"];
    
    
    //check and create users
    if (isFirstStart && confIn["users"] instanceof Array) {
        for (const user of confIn["users"]) {
            if (confIn["users"] instanceof Object && typeof user["username"] === "string" && typeof user["pass"] === "string") {
                let isCorrect = true;
                //check email
                if (typeof user["email"] === "string") {
                    const hasEmail = await checkExist(confOut["db"], "users", "email", user["email"]);
                    if (confOut["allowSameEmail"] === false && hasEmail === true) {
                        isCorrect = false;
                        console.log("Skip user (" + user["username"] + ") - not allowed duplicated emails (" + user["email"] + ")");
                    }
                } else {
                    user["email"] = "";
                }
                
                //check username
                if (isCorrect) {
                    const hasUsename = await checkExist(confOut["db"], "users", "username", user["username"]);
                    if (hasUsename === true) {
                        isCorrect = false;
                        console.log("Skip user (" + user["username"] + ") - not allowed duplicated username");
                    }
                }
                
                //add user
                if (isCorrect) {
                    let id = await genID(confOut["db"], "users", "user_id");
                    id = mysqlRealEscapeString(id);
                    let email = mysqlRealEscapeString(user["email"]);
                    let username = mysqlRealEscapeString(user["username"]);
                    let pass = mysqlRealEscapeString(crypto.createHash("sha256")
                        .update(user["pass"])
                        .digest("hex"));
                    await mysqlQuery(confOut["db"], `
                        INSERT INTO \`users\` (\`user_id\`, \`email\`, \`username\`, \`password\`)
                        VALUES (
                            '` + id + `',
                            '` + email + `',
                            '` + username + `',
                            '` + pass + `'
                        );
                    `);
                    if (user?.["isAdmin"] === true) {
                        await mysqlQuery(confOut["db"], `
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
    input configuration:
        {
            "port": 8888,
            "https": {                 //optional
                "key": "server.key",
		        "cert": "server.crt",
		        "redirectFrom": 80
            },
            "db": "database.db",
            "email": {                 //optional
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
            "users": [                //optional
                {
                    "email":"",
                    "username":"admin",
                    "pass":"admin",
                    "isAdmin": false   // optional
                }
            ]
        }

    output configuration:
        {
            "port": 8888,
            "https": {                 //optional
                "key": "FILEDATA",
		        "cert": "FILEDATA",
		        "redirectFrom": 80     //optional
            },
            "db": "dbObject,
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


const startStaticServer = async function(conf) {
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
            'Content-Length': Buffer.byteLength(fileData["buffer"]),
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

//Main funtion
const main = async function() {
    //read CLI options
    const confPath = getArg(process.argv, "--configuration=", "conf/conf.json");
    
    //Load configuration
    const conf = await initialSetup(confPath);
    
    //Business logic
    // Expected output: 1

    

    
    //Start server
    const servers = await startStaticServer(conf);
    console.log("Press CTRL+C to stop servers");
    
    
    
    //cleanup
    const exitServer = async function() {
        console.log("Closing database...");
        await new Promise(function(resolve) {
            conf["db"].close(function(error) {
                resolve(true);
            });
        });
        console.log("Closing servers...");
        for (const server of servers) {
            await new Promise(function(resolve) {
                server.close(function() {
                    resolve(true);
                });
            });
        }
        
    };
    
    process.on("SIGTERM", async function() {
        console.log("SIGTERM signal received.");
        // Perform cleanup tasks here
        await exitServer();
        
    });
    
    process.on("SIGINT", async function() {
        console.log("SIGINT signal received.");
        // Perform cleanup tasks here
        await exitServer();
    });
};
main();