"use strict";

const os = require("node:os");

const Control = require("./" + os.platform() + "-" + os.arch() + "/easy-control.node");

module.exports = Control;