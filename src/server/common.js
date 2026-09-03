"use strict";

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import fs from "node:fs/promises";
import https from "node:https";

//
// Shared constants
//
// root of the server and client sources (./src)
const serverScriptPath = path.resolve(import.meta.dirname, "..");

// client version is the project version, read once on the first ask
const packageJsonPath = path.resolve(import.meta.dirname, "../../package.json");
let clientVersion = null;
const getVersion = async function() {
    if (clientVersion === null) {
        clientVersion = JSON.parse(await fs.readFile(packageJsonPath, "utf8"))["version"];
    }
    return clientVersion;
};

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

//
// REST helpers
//
// read a text (JSON) resource of an HTTPS endpoint
const httpsGetText = async function(url) {
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

// read an image of an HTTPS endpoint into a data URI
const httpsGetImage = async function(url) {
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

// search in parameters
//
// One rule for the whole CLI, and it is read off the name rather than carried
// in a flag beside it: a short option takes its value as the next argument,
// "-c ./conf/config.json", and a long one takes it joined by an equals sign,
// "--configuration=./conf/config.json". Nothing accepts both, so there is one
// spelling of every call and --help can state it exactly.
//
// Without isKeyValue the name is a switch and is true when it is there at all.
const argGet = function(args, argName, isKeyValue=false) {
    const isLong = argName.startsWith("--");
    for (let i = 0, length=args.length; i < length; i++) {
        const arg = args[i];
        if (isKeyValue === false) {
            if (arg === argName) {
                return true;
            }
            continue;
        }
        if (isLong === true) {
            if (arg.startsWith(argName + "=")) {
                return arg.slice(argName.length + 1);
            }
            continue;
        }
        if (arg === argName) {
            const value = args[i + 1];
            // the option was written with nothing behind it, or with the next
            // option behind it - taking "--compile" as the path would fail much
            // further along, and as something the user never typed
            if (typeof value === "undefined" || value.startsWith("-") === true) {
                return undefined;
            }
            return value;
        }
    }
    return undefined;
};

// the rule above, broken the two ways it can be
//
// A form argGet does not read is a value it never sees, and the caller falls
// back to its default: the server would boot on a configuration nobody asked
// for and say nothing. The names that carry a value are handed in here so the
// CLI can refuse the wrong form and name the right one.
const argCheck = function(args, valueArgs) {
    for (const arg of args) {
        for (const argName of valueArgs) {
            if (argName.startsWith("--") === true) {
                if (arg === argName) {
                    return argName + " takes its value joined by an equals sign: " + argName + "=<value>";
                }
            } else if (arg.startsWith(argName + "=") === true) {
                return argName + " takes its value as the next argument: " + argName + " <value>";
            }
        }
    }
    return undefined;
};

// check if dir is empty
const isDirEmpty = async function(dirPath) {
    try {
        const dirIter = await fs.opendir(dirPath);
        const {done} = await dirIter[Symbol.asyncIterator]().next();
        if (done === false) {
            await dirIter.close();
            return false;   // a first entry means the folder holds something
        }
        return true;        // the iterator closed itself on the last entry
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

export { serverScriptPath, getVersion, generateId, binarySearch, argGet, argCheck, isDirEmpty, setAbsolute, httpsGetText, httpsGetImage };
export default { serverScriptPath, getVersion, generateId, binarySearch, argGet, argCheck, isDirEmpty, setAbsolute, httpsGetText, httpsGetImage };