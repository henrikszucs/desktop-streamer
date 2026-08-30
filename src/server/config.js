"use strict";

// internal dependencies
import fs from "node:fs/promises";

// third-party dependencies
import Ajv from "ajv"

const definitions = {
    "port": {
        "type": "integer",
        "minimum": 1,
        "maximum": 65535
    },
    "text": {
        "type": "string",
        "minLength": 1
    },
    "bytes": {
        "type": "integer",
        "minimum": 0
    }
};

const httpSchema = {
    "type": "object",
    "required": ["domain", "port", "key", "cert"],
    "additionalProperties": false,
    "properties": {
        // (optional) customized name of the application, keyed by language code
        "name": {
            "type": "object",
            "minProperties": 1,
            "propertyNames": {
                "pattern": "^[a-z]{2}(-[A-Za-z0-9]+)*$"
            },
            "additionalProperties": {
                "$ref": "#/definitions/text"
            }
        },
        // access domain
        "domain": {
            "$ref": "#/definitions/text"
        },
        // port of the server
        "port": {
            "$ref": "#/definitions/port"
        },
        // private key path
        "key": {
            "$ref": "#/definitions/text"
        },
        // private cert path
        "cert": {
            "$ref": "#/definitions/text"
        },
        // (optional) HTTP port that redirects to HTTPS
        "redirect": {
            "$ref": "#/definitions/port"
        },
        // (optional) cache HTTP server data into memory
        "cache": {
            "type": "object",
            "required": ["size", "fileSizeLimit"],
            "additionalProperties": false,
            "properties": {
                // max cache size in bytes
                "size": {
                    "$ref": "#/definitions/bytes"
                },
                // max file size that can be cached
                "fileSizeLimit": {
                    "$ref": "#/definitions/bytes"
                }
            }
        },
        // (optional) remote websocket server, it ignores local ws creation
        "remote": {
            "type": "object",
            "required": ["host", "port"],
            "additionalProperties": false,
            "properties": {
                "host": {
                    "$ref": "#/definitions/text"
                },
                "port": {
                    "$ref": "#/definitions/port"
                }
            }
        }
    }
};

const wsSchema = {
    "type": "object",
    "required": ["domain", "port", "key", "cert", "database", "webrtc", "email", "auth", "permissions"],
    "additionalProperties": false,
    "properties": {
        // access domain
        "domain": {
            "$ref": "#/definitions/text"
        },
        "port": {
            "$ref": "#/definitions/port"
        },
        // private key path
        "key": {
            "$ref": "#/definitions/text"
        },
        // private cert path
        "cert": {
            "$ref": "#/definitions/text"
        },
        // MySQL server connection
        "database": {
            "type": "object",
            "required": ["type", "host", "port", "user", "pass", "db"],
            "additionalProperties": false,
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["mysql"]
                },
                "host": {
                    "$ref": "#/definitions/text"
                },
                "port": {
                    "$ref": "#/definitions/port"
                },
                "user": {
                    "type": "string"
                },
                "pass": {
                    "type": "string"
                },
                "db": {
                    "$ref": "#/definitions/text"
                }
            }
        },
        "webrtc": {
            "type": "object",
            "required": ["iceServers"],
            "additionalProperties": false,
            "properties": {
                "iceServers": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "$ref": "#/definitions/text"
                    }
                }
            }
        },
        // email sending connection with smtp
        "email": {
            "type": "object",
            "required": ["host", "port", "user", "auth"],
            "additionalProperties": false,
            "properties": {
                "host": {
                    "$ref": "#/definitions/text"
                },
                "port": {
                    "$ref": "#/definitions/port"
                },
                "user": {
                    "$ref": "#/definitions/text"
                },
                // password or OAuth2 authentication
                "auth": {
                    "type": "object",
                    "required": ["type"],
                    "oneOf": [
                        {
                            "required": ["password"],
                            "additionalProperties": false,
                            "properties": {
                                "type": {
                                    "const": "password"
                                },
                                "password": {
                                    "$ref": "#/definitions/text"
                                }
                            }
                        },
                        {
                            "required": ["clientId", "clientSecret", "refreshToken"],
                            "additionalProperties": false,
                            "properties": {
                                "type": {
                                    "const": "OAuth2"
                                },
                                "clientId": {
                                    "$ref": "#/definitions/text"
                                },
                                "clientSecret": {
                                    "$ref": "#/definitions/text"
                                },
                                "refreshToken": {
                                    "$ref": "#/definitions/text"
                                }
                            }
                        }
                    ]
                }
            }
        },
        // Google auth keys
        "auth": {
            "type": "object",
            "minProperties": 1,
            "additionalProperties": false,
            "properties": {
                "google": {
                    "type": "object",
                    "required": ["clientId", "clientSecret"],
                    "additionalProperties": false,
                    "properties": {
                        "clientId": {
                            "$ref": "#/definitions/text"
                        },
                        "clientSecret": {
                            "$ref": "#/definitions/text"
                        }
                    }
                }
            }
        },
        // permission settings
        "permissions": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                // Allow guest user to share screen
                "guestAllowShare": {
                    "type": "boolean",
                    "default": true
                },
                // Allow guest user to join to a screen
                "guestAllowJoin": {
                    "type": "boolean",
                    "default": true
                },
                // Guest user allow to use server for media data transfer
                "guestAllowRelay": {
                    "type": "boolean",
                    "default": false
                },
                // Newly registered users get relay permission as allow or deny
                "userRegisterRelay": {
                    "type": "boolean",
                    "default": true
                }
            }
        }
    }
};

const schema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Desktop Streamer Server Configuration",
    "type": "object",
    "additionalProperties": false,
    // at least one of the servers must be configured
    "anyOf": [
        {
            "required": ["http"]
        },
        {
            "required": ["ws"]
        }
    ],
    "properties": {
        "http": httpSchema,
        "ws": wsSchema
    },
    "definitions": definitions
};

const ajv = new Ajv({
    "allErrors": true
});
const validate = ajv.compile(schema);

const checkConfig = (config) => {
    const valid = validate(config);
    if (!valid) {
        return {
            valid: false,
            errors: validate.errors
        };
    }
    return {
        valid: true,
        errors: []
    };
};

// check the constraints that the schema cannot express
const checkConstraints = (config) => {
    const http = config["http"];
    const ws = config["ws"];

    // check port collisions
    const ports = [];
    if (typeof http === "object") {
        ports.push(["HTTP port", http["port"]]);
        if (typeof http["redirect"] === "number") {
            ports.push(["HTTP redirect port", http["redirect"]]);
        }
    }
    if (typeof ws === "object") {
        ports.push(["WS port", ws["port"]]);
    }
    for (let i = 0, length = ports.length; i < length; i++) {
        for (let j = i + 1; j < length; j++) {
            if (ports[i][1] === ports[j][1]) {
                return ports[j][0] + " cannot be the same as the " + ports[i][0] + ": " + ports[i][1];
            }
        }
    }

    // check HTTP and WS server constraints
    if (typeof http === "object" && typeof http["remote"] !== "object" && typeof ws !== "object") {
        return "HTTP remote configuration must be provided if no local WS server in configuration!";
    }
    if (typeof ws === "object" && typeof http === "object" && typeof http["remote"] === "object") {
        return "WS server cannot be created if HTTP remote is configured!";
    }

    return "";
};

// load the conf file and check its contents, it returns the config or throws an error
const loadConfig = async (confPath) => {
    // load conf file (required)
    let contents = "";
    try {
        contents = await fs.readFile(confPath, {
            "encoding": "utf8"
        });
    } catch (error) {
        throw new Error("Cannot read configuration file: " + confPath + " - " + error.message);
    }

    // parse conf file
    let config = null;
    try {
        config = JSON.parse(contents);
    } catch (error) {
        throw new Error("Invalid configuration file: " + confPath + " - " + error.message);
    }
    if (typeof config !== "object" || config === null || Array.isArray(config) === true) {
        throw new Error("Invalid configuration file: " + confPath + " - root element must be an object");
    }

    // check conf file against the schema
    const result = checkConfig(config);
    if (result["valid"] === false) {
        const details = result["errors"].map((error) => {
            return "  " + (error["instancePath"] || "/") + " " + error["message"];
        }).join("\n");
        throw new Error("Invalid configuration file: " + confPath + "\n" + details);
    }

    // check the constraints that the schema cannot express
    const constraintError = checkConstraints(config);
    if (constraintError !== "") {
        throw new Error("Invalid configuration file: " + confPath + "\n  " + constraintError);
    }

    return config;
};

export { schema, checkConfig, loadConfig };
export default { schema, checkConfig, loadConfig };
