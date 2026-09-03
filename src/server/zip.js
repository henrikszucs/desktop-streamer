"use strict";

//
// Import dependencies
//
// internal dependencies
import zlib from "node:zlib";
import fs from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const deflateRaw = promisify(zlib.deflateRaw);

//
// Constants
//
// the four records of the format, by their signature
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

// general purpose bit 0 is encryption, bit 3 says the sizes follow the data in a
// descriptor instead of standing in the local header
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DESCRIPTOR = 0x0008;

// bit 11 says the name is UTF-8, without it an unzipper reads it as CP437
const FLAG_UTF8 = 0x0800;

// this writer speaks plain zip, everything a zip64 file needs is over these
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

// "made by" version 3.0 on unix, so the external attributes carry a file mode
const VERSION_MADE_BY = 0x031e;
const VERSION_NEEDED = 20;

// deflating a 80 MB binary keeps one thread of the pool busy for seconds, a few
// of them at once fill the cores without holding the whole client in memory
const CONCURRENCY = Math.max(2, Math.min(os.availableParallelism?.() ?? 4, 4));

//
// Checksum
//
// node grew a native crc32 in 20.15, the table is for the versions below it
const crcTable = (function() {
    if (typeof zlib.crc32 === "function") {
        return null;
    }
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let value = i;
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[i] = value >>> 0;
    }
    return table;
})();

const crc32 = function(data) {
    if (crcTable === null) {
        return zlib.crc32(data);
    }
    let crc = 0xffffffff;
    for (let i = 0, length = data.length; i < length; i++) {
        crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
};

//
// Dates
//
// the format keeps the modification time in the two halves of a DOS timestamp,
// two second resolution, no year before 1980
const dosDateTime = function(date) {
    const year = Math.max(date.getFullYear(), 1980);
    return {
        "date": ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
        "time": (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
    };
};

//
// Reading
//
// the end of central directory record, at the end of the file behind a comment
// of up to 64 KB
const findEndRecord = function(buffer) {
    const start = Math.max(0, buffer.length - MAX_UINT16 - 22);
    for (let i = buffer.length - 22; i >= start; i--) {
        if (buffer.readUInt32LE(i) === SIG_EOCD) {
            return i;
        }
    }
    throw new Error("Not a zip file, no end of central directory record");
};

// every entry of a zip, each one carrying the bytes it holds still compressed so
// it can be copied into another zip without going through deflate twice
const readZip = function(buffer) {
    const end = findEndRecord(buffer);
    const count = buffer.readUInt16LE(end + 10);
    const centralOffset = buffer.readUInt32LE(end + 16);
    if (count === MAX_UINT16 || centralOffset === MAX_UINT32) {
        throw new Error("Zip64 archives are not supported");
    }

    const entries = [];
    let offset = centralOffset;
    for (let i = 0; i < count; i++) {
        if (buffer.readUInt32LE(offset) !== SIG_CENTRAL) {
            throw new Error("Broken central directory at entry " + i);
        }
        const flags = buffer.readUInt16LE(offset + 8);
        const method = buffer.readUInt16LE(offset + 10);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const size = buffer.readUInt32LE(offset + 24);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

        if ((flags & FLAG_ENCRYPTED) !== 0) {
            throw new Error("Encrypted zip entry: " + name);
        }
        if (compressedSize === MAX_UINT32 || size === MAX_UINT32 || localOffset === MAX_UINT32) {
            throw new Error("Zip64 entry is not supported: " + name);
        }

        // the local header repeats the name and may carry a different extra
        // field, so the data starts behind the one written there, not this one
        if (buffer.readUInt32LE(localOffset) !== SIG_LOCAL) {
            throw new Error("Broken local header of " + name);
        }
        const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);

        entries.push({
            "name": name,
            "isDir": name.endsWith("/"),
            // the descriptor of the source is dropped, the sizes are written out
            "flags": flags & ~FLAG_DESCRIPTOR,
            "method": method,
            "time": buffer.readUInt16LE(offset + 12),
            "date": buffer.readUInt16LE(offset + 14),
            "crc": buffer.readUInt32LE(offset + 16),
            "size": size,
            "versionMadeBy": buffer.readUInt16LE(offset + 4),
            "externalAttrs": buffer.readUInt32LE(offset + 38),
            "raw": buffer.subarray(dataOffset, dataOffset + compressedSize)
        });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
};

//
// Writing
//
const localHeader = function(entry, nameBuffer) {
    const header = Buffer.allocUnsafe(30);
    header.writeUInt32LE(SIG_LOCAL, 0);
    header.writeUInt16LE(VERSION_NEEDED, 4);
    header.writeUInt16LE(entry["flags"], 6);
    header.writeUInt16LE(entry["method"], 8);
    header.writeUInt16LE(entry["time"], 10);
    header.writeUInt16LE(entry["date"], 12);
    header.writeUInt32LE(entry["crc"], 14);
    header.writeUInt32LE(entry["raw"].length, 18);
    header.writeUInt32LE(entry["size"], 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    return header;
};

const centralHeader = function(entry, nameBuffer) {
    const header = Buffer.allocUnsafe(46);
    header.writeUInt32LE(SIG_CENTRAL, 0);
    header.writeUInt16LE(entry["versionMadeBy"], 4);
    header.writeUInt16LE(VERSION_NEEDED, 6);
    header.writeUInt16LE(entry["flags"], 8);
    header.writeUInt16LE(entry["method"], 10);
    header.writeUInt16LE(entry["time"], 12);
    header.writeUInt16LE(entry["date"], 14);
    header.writeUInt32LE(entry["crc"], 16);
    header.writeUInt32LE(entry["raw"].length, 20);
    header.writeUInt32LE(entry["size"], 24);
    header.writeUInt16LE(nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);            // extra
    header.writeUInt16LE(0, 32);            // comment
    header.writeUInt16LE(0, 34);            // disk
    header.writeUInt16LE(0, 36);            // internal attributes
    header.writeUInt32LE(entry["externalAttrs"], 38);
    header.writeUInt32LE(entry["offset"], 42);
    return header;
};

const endRecord = function(count, centralSize, centralOffset) {
    const record = Buffer.allocUnsafe(22);
    record.writeUInt32LE(SIG_EOCD, 0);
    record.writeUInt16LE(0, 4);
    record.writeUInt16LE(0, 6);
    record.writeUInt16LE(count, 8);
    record.writeUInt16LE(count, 10);
    record.writeUInt32LE(centralSize, 12);
    record.writeUInt32LE(centralOffset, 16);
    record.writeUInt16LE(0, 20);
    return record;
};

// what a source entry gives away for free, and what a new file has to be told:
// the file mode in the high half, the MS-DOS attribute byte in the low one
const attributesOf = function(mode, isDir) {
    const fallback = (isDir === true ? 0o755 : 0o644);
    const unix = ((typeof mode === "number" ? mode : fallback) & 0xffff) << 16;
    return (unix | (isDir === true ? 0x10 : 0)) >>> 0;
};

// the bytes an entry takes in the zip, deflated unless that makes it bigger
const compressEntry = async function(entry, level) {
    let data = entry["data"];
    if (typeof data === "undefined") {
        data = await fs.readFile(entry["path"]);
    }
    const raw = await deflateRaw(data, {"level": level});
    const isWorth = raw.length < data.length;
    return {
        "flags": 0,
        "method": (isWorth === true ? METHOD_DEFLATE : METHOD_STORE),
        "crc": crc32(data),
        "size": data.length,
        "raw": (isWorth === true ? raw : data)
    };
};

// a folder is a name and nothing else
const emptyEntry = function() {
    return {
        "flags": 0,
        "method": METHOD_STORE,
        "crc": 0,
        "size": 0,
        "raw": Buffer.alloc(0)
    };
};

// backpressure, a 200 MB zip does not fit in the pipe at once - one error
// listener for the whole write, a listener per chunk would run past the limit
const streamWriter = function(stream) {
    let failure = null;
    stream.on("error", function(error) {
        failure = error;
    });
    return function(chunk) {
        if (failure !== null) {
            return Promise.reject(failure);
        }
        if (stream.write(chunk) === true) {
            return Promise.resolve();
        }
        return new Promise(function(resolve, reject) {
            const onDrain = function() {
                stream.removeListener("error", onError);
                resolve();
            };
            const onError = function(error) {
                stream.removeListener("drain", onDrain);
                reject(error);
            };
            stream.once("drain", onDrain);
            stream.once("error", onError);
        });
    };
};

// write a zip of the given entries in order: "raw" with its "crc"/"size" is
// copied over already deflated, "data" or "path" is deflated here, a few at once
const writeZip = async function(stream, entries, level=9) {
    if (entries.length > MAX_UINT16) {
        throw new Error("Too many zip entries for a plain zip: " + entries.length);
    }
    const write = streamWriter(stream);

    // start the first few, every write takes the next one on - each is settled
    // rather than left to reject ahead of its await and end the process
    const pending = new Array(entries.length).fill(null);
    const settle = function(promise) {
        return promise.then(function(value) {
            return {"value": value};
        }, function(error) {
            return {"error": error};
        });
    };
    const start = function(index) {
        if (index >= entries.length) {
            return;
        }
        const entry = entries[index];
        if (typeof entry["raw"] !== "undefined") {
            pending[index] = settle(Promise.resolve(entry));
        } else if (entry["isDir"] === true) {
            pending[index] = settle(Promise.resolve(Object.assign({}, entry, emptyEntry())));
        } else {
            pending[index] = settle(compressEntry(entry, level).then(function(built) {
                return Object.assign({}, entry, built);
            }));
        }
    };

    // whatever is still deflating when this returns or throws, waited on so the
    // caller is never left with reads running behind its own failure
    const drain = async function() {
        for (let i = 0; i < pending.length; i++) {
            if (pending[i] !== null) {
                await pending[i];
                pending[i] = null;
            }
        }
    };

    const writeEntries = async function() {
        const central = [];
        let offset = 0;
        for (let i = 0; i < entries.length; i++) {
            const settled = await pending[i];
            pending[i] = null;      // let the bytes go as soon as they are written
            start(i + CONCURRENCY);
            if (typeof settled["error"] !== "undefined") {
                throw settled["error"];
            }
            const entry = settled["value"];

            if (typeof entry["versionMadeBy"] === "undefined") {
                entry["versionMadeBy"] = VERSION_MADE_BY;
            }
            if (typeof entry["externalAttrs"] === "undefined") {
                entry["externalAttrs"] = attributesOf(entry["mode"], entry["isDir"]);
            }
            if (typeof entry["time"] === "undefined") {
                const stamp = dosDateTime(entry["date"] instanceof Date ? entry["date"] : new Date());
                entry["time"] = stamp["time"];
                entry["date"] = stamp["date"];
            }
            entry["offset"] = offset;

            const nameBuffer = Buffer.from(entry["name"], "utf8");
            if (nameBuffer.length !== entry["name"].length) {
                entry["flags"] = entry["flags"] | FLAG_UTF8;
            }
            const header = localHeader(entry, nameBuffer);
            await write(header);
            await write(nameBuffer);
            if (entry["raw"].length > 0) {
                await write(entry["raw"]);
            }
            offset += header.length + nameBuffer.length + entry["raw"].length;
            if (offset > MAX_UINT32) {
                throw new Error("Zip is over 4 GB, which a plain zip cannot address");
            }

            central.push(centralHeader(entry, nameBuffer));
            central.push(nameBuffer);
        }

        const centralOffset = offset;
        let centralSize = 0;
        for (const chunk of central) {
            await write(chunk);
            centralSize += chunk.length;
        }
        await write(endRecord(entries.length, centralSize, centralOffset));

        return offset + centralSize + 22;
    };

    for (let i = 0; i < CONCURRENCY; i++) {
        start(i);
    }
    try {
        return await writeEntries();
    } finally {
        await drain();
    }
};

export { readZip, writeZip, crc32, dosDateTime, METHOD_STORE, METHOD_DEFLATE };
export default { readZip, writeZip, crc32, dosDateTime, METHOD_STORE, METHOD_DEFLATE };
