"use strict";

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import fs from "node:fs/promises";
import https from "node:https";
import crypto from "node:crypto";

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

// generate random ID. Session keys, delete keys, join codes and room keys are
// all made here, so it draws from the CSPRNG: Math.random is predictable from
// the outputs anybody can observe (their own codes and keys)
const generateId = function(length=10, chars="1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
    let id = "";
    for (let i = 0; i < length; i++) {
        id += chars[crypto.randomInt(chars.length)];
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
// how long a request to another server is given, answer and all: a sign-in
// waits on Google's, and one that never comes must not hold the call open
const HTTPS_TIMEOUT = 10000;

// one GET of an HTTPS resource, its body in the encoding asked for, settled
// once whichever way it ends - an answer, an error, a response cut off before
// its end, or the clock
const httpsGetBody = function(url, encoding, timeout) {
    return new Promise((resolve, reject) => {
        let isSettled = false;
        let timeoutId = -1;
        const settle = function(error, value) {
            if (isSettled === true) {
                return;
            }
            isSettled = true;
            clearTimeout(timeoutId);
            if (error !== null) {
                reject(error);
            } else {
                resolve(value);
            }
        };

        const req = https.get(url, (res) => {
            const statusCode = res.statusCode;
            if (statusCode !== 200) {
                // Consume response data to free up memory
                res.resume();
                settle(new Error("Request Failed.\n" + `Status Code: ${statusCode}`));
                return;
            }

            let rawData = "";
            res.setEncoding(encoding);
            res.on("data", (chunk) => {
                rawData += chunk;
            });
            res.on("end", () => {
                settle(null, {"body": rawData, "contentType": res.headers["content-type"]});
            });
            res.on("close", () => {
                settle(new Error("Response closed before its end"));
            });
        });
        req.on("error", (error) => {
            console.error(`Got error: ${error.message}`);
            settle(error);
        });
        timeoutId = setTimeout(function() {
            req.destroy();
            settle(new Error("Request timed out after " + timeout + " ms"));
        }, timeout);
    });
};

// read a text (JSON) resource of an HTTPS endpoint
const httpsGetText = async function(url, timeout=HTTPS_TIMEOUT) {
    return (await httpsGetBody(url, "utf8", timeout))["body"];
};

// read an image of an HTTPS endpoint into a data URI
const httpsGetImage = async function(url, timeout=HTTPS_TIMEOUT) {
    const answer = await httpsGetBody(url, "base64", timeout);
    return "data:" + answer["contentType"] + ";base64," + answer["body"];
};

// search in parameters: a switch, "--name=value" with isInline, or "--name value"
// without it - a plain reader, checkArg below is what holds callers to one form
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

// the CLI rule: a wrong form is refused by name instead of falling back to a
// default, as is a short option with nothing or the next option behind it
const checkArg = function(args, valueArgs) {
    for (let i = 0, length=args.length; i < length; i++) {
        const arg = args[i];
        for (const argName of valueArgs) {
            const inlineForm = argName + " takes its value joined by an equals sign: " + argName + "=<value>";
            const separateForm = argName + " takes its value as the next argument: " + argName + " <value>";
            if (argName.startsWith("--") === true) {
                if (arg === argName) {
                    return inlineForm;
                }
            } else if (arg.startsWith(argName + "=") === true) {
                return separateForm;
            } else if (arg === argName) {
                const value = args[i + 1];
                if (typeof value === "undefined" || value.startsWith("-") === true) {
                    return separateForm;
                }
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

export { serverScriptPath, getVersion, generateId, binarySearch, getArg, checkArg, isDirEmpty, setAbsolute, httpsGetText, httpsGetImage };
export default { serverScriptPath, getVersion, generateId, binarySearch, getArg, checkArg, isDirEmpty, setAbsolute, httpsGetText, httpsGetImage };