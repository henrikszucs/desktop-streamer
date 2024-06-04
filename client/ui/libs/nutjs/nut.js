"use strict";

const path = require("node:path"); 
const os = require("node:os"); 

const patform = os.platform();
const arch = os.arch();

let lib = null;

const libname = "libnut.node";
if (patform === "win32") {
	lib = require(path.resolve(__dirname + "/win32/" + libname));
}

module.exports = lib;