"use strict";

import Ajv from "ajv"

const schema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Desktop Streamer Server Configuration",
    "type": "object",
    "required": ["domain", "port", "key", "cert", "webrtc"],
    "additionalProperties": false,
    "properties": {
        "domain": {
            "type": "string",
            "minLength": 1
        },
        "port": {
            "type": "integer",
            "minimum": 1,
            "maximum": 65535
        },
        "redirect": {
            "type": "integer",
            "minimum": 1,
            "maximum": 65535
        },
        "key": {
            "type": "string",
            "minLength": 1
        },
        "cert": {
            "type": "string",
            "minLength": 1
        },
        "ws": {
            "type": "integer",
            "minimum": 1,
            "maximum": 65535
        },
        "webrtc": {
            "type": "object",
            "required": ["iceServers"],
            "additionalProperties": false,
            "properties": {
                "iceServers": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "minLength": 1
                    },
                    "minItems": 1
                }
            }
        }
    }
};

const ajv = new Ajv();
const validate = ajv.compile(schema);

// TODO: check config file with json schema
const isValidConfig = (config) => {
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
