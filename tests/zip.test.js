"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { Writable } from "node:stream";

// first-party dependencies
import { readZip, writeZip, crc32, METHOD_STORE, METHOD_DEFLATE } from "../src/server/zip.js";

// the desktop client is packed by this module and unpacked by whatever the user
// has, so every check below goes through node:zlib rather than through the
// reader in the same file

// collect what writeZip streams out
const collect = function() {
    const chunks = [];
    const stream = new Writable({
        "write": function(chunk, encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback();
        }
    });
    stream.buffer = function() {
        return Buffer.concat(chunks);
    };
    return stream;
};

const build = async function(entries, level=9) {
    const stream = collect();
    const size = await writeZip(stream, entries, level);
    const buffer = stream.buffer();
    assert.equal(size, buffer.length, "writeZip reported a size the stream does not have");
    return buffer;
};

// the bytes of an entry, taken apart with zlib and not with readZip
const contentOf = function(entry) {
    if (entry["method"] === METHOD_STORE) {
        return Buffer.from(entry["raw"]);
    }
    return zlib.inflateRawSync(entry["raw"]);
};

const text = function(value, times=1) {
    return Buffer.from(value.repeat(times), "utf8");
};

//
// crc32
//
test("crc32 matches the check value of the algorithm", () => {
    assert.equal(crc32(Buffer.from("123456789", "utf8")), 0xcbf43926);
});

test("crc32 of nothing is zero", () => {
    assert.equal(crc32(Buffer.alloc(0)), 0);
});

//
// Writing and reading back
//
test("a written zip reads back with every file intact", async () => {
    const files = [
        ["index.html", text("<!DOCTYPE html><html></html>")],
        ["src/index.js", text("const a = 1;\n", 500)],
        ["media/icon.svg", text("<svg></svg>")]
    ];
    const buffer = await build(files.map(function([name, data]) {
        return {"name": name, "data": data};
    }));

    const entries = readZip(buffer);
    assert.equal(entries.length, files.length);
    for (let i = 0; i < files.length; i++) {
        assert.equal(entries[i]["name"], files[i][0]);
        assert.equal(entries[i]["isDir"], false);
        assert.equal(entries[i]["size"], files[i][1].length);
        assert.equal(entries[i]["crc"], crc32(files[i][1]));
        assert.deepEqual(contentOf(entries[i]), files[i][1]);
    }
});

test("a file that compresses is deflated, one that does not is stored", async () => {
    const compressible = text("aaaaaaaaaa", 200);
    const random = Buffer.alloc(2048);
    for (let i = 0; i < random.length; i++) {
        random[i] = (i * 2654435761) & 0xff;    // no run for deflate to find
    }
    const buffer = await build([
        {"name": "text.txt", "data": compressible},
        {"name": "noise.bin", "data": zlib.gzipSync(random, {"level": 9})}
    ]);

    const entries = readZip(buffer);
    assert.equal(entries[0]["method"], METHOD_DEFLATE);
    assert.equal(entries[0]["raw"].length < compressible.length, true);
    assert.equal(entries[1]["method"], METHOD_STORE, "already compressed data should be stored, not grown");
    assert.deepEqual(contentOf(entries[0]), compressible);
    assert.deepEqual(contentOf(entries[1]), zlib.gzipSync(random, {"level": 9}));
});

test("a file read from a path lands the same as one held in memory", async () => {
    const buffer = await build([
        {"name": "package.json", "path": "package.json"}
    ]);
    const entries = readZip(buffer);
    const onDisk = await (await import("node:fs/promises")).readFile("package.json");
    assert.deepEqual(contentOf(entries[0]), onDisk);
});

test("folders keep their trailing slash and stay empty", async () => {
    const buffer = await build([
        {"name": "resources/", "isDir": true},
        {"name": "resources/app.txt", "data": text("x")}
    ]);
    const entries = readZip(buffer);
    assert.equal(entries[0]["isDir"], true);
    assert.equal(entries[0]["size"], 0);
    assert.equal(entries[0]["raw"].length, 0);
    assert.equal(entries[0]["method"], METHOD_STORE);
    assert.equal(entries[1]["isDir"], false);
});

test("a name outside ASCII survives the round trip and is flagged UTF-8", async () => {
    const name = "media/megosztás-é.svg";
    const buffer = await build([
        {"name": name, "data": text("<svg/>")},
        {"name": "media/plain.svg", "data": text("<svg/>")}
    ]);
    const entries = readZip(buffer);
    assert.equal(entries[0]["name"], name);
    assert.equal((entries[0]["flags"] & 0x0800) !== 0, true, "an unzipper reads an unflagged name as CP437");
    assert.equal(entries[1]["flags"] & 0x0800, 0);
});

//
// Copying entries over, the reason the desktop build is fast
//
test("an entry taken from another zip is copied without deflating it again", async () => {
    const payload = text("electron binary payload ", 400);
    const source = await build([
        {"name": "resources/electron.txt", "data": payload},
        {"name": "locales/", "isDir": true}
    ]);

    // hand the entries of the first zip straight to the second one
    const sourceEntries = readZip(source);
    const copy = await build([
        ...sourceEntries,
        {"name": "resources/app/config.json", "data": text("{}")}
    ]);

    const copied = readZip(copy);
    assert.equal(copied.length, 3);
    assert.deepEqual(copied[0]["raw"], sourceEntries[0]["raw"], "the deflated bytes should have been copied as they were");
    assert.equal(copied[0]["crc"], sourceEntries[0]["crc"]);
    assert.equal(copied[0]["size"], payload.length);
    assert.deepEqual(contentOf(copied[0]), payload);
    assert.equal(copied[1]["isDir"], true);
    assert.deepEqual(contentOf(copied[2]), text("{}"));
});

test("dropping an entry on the way over leaves the rest readable", async () => {
    const source = await build([
        {"name": "resources/default_app.asar", "data": text("asar", 50)},
        {"name": "resources/keep.txt", "data": text("keep", 50)}
    ]);
    const kept = readZip(source).filter(function(entry) {
        return entry["name"] !== "resources/default_app.asar";
    });
    const entries = readZip(await build(kept));
    assert.deepEqual(entries.map(function(entry) { return entry["name"]; }), ["resources/keep.txt"]);
    assert.deepEqual(contentOf(entries[0]), text("keep", 50));
});

//
// Attributes
//
test("a file mode reaches the external attributes, a folder is marked as one", async () => {
    const buffer = await build([
        {"name": "bin/", "isDir": true, "mode": 0o40755},
        {"name": "bin/run.sh", "data": text("#!/bin/sh\n"), "mode": 0o100755}
    ]);
    const entries = readZip(buffer);
    assert.equal((entries[0]["externalAttrs"] & 0x10) !== 0, true, "a folder carries the MS-DOS directory bit");
    assert.equal((entries[0]["externalAttrs"] >>> 16) & 0o777, 0o755);
    assert.equal((entries[1]["externalAttrs"] >>> 16) & 0o777, 0o755, "the executable bit has to survive for the darwin and linux clients");
    assert.equal(entries[1]["externalAttrs"] & 0x10, 0);
});

test("an entry with no mode still writes a readable one", async () => {
    const entries = readZip(await build([{"name": "a.txt", "data": text("a")}]));
    assert.equal((entries[0]["externalAttrs"] >>> 16) & 0o777, 0o644);
});

//
// What the reader refuses
//
test("reading something that is not a zip says so", () => {
    assert.throws(function() {
        readZip(Buffer.alloc(2048));
    }, /no end of central directory/);
});

test("reading a zip whose central directory is broken says so", async () => {
    const buffer = await build([{"name": "a.txt", "data": text("a", 100)}]);

    // the end record points at the central directory, walk it into the payload
    const end = buffer.length - 22;
    buffer.writeUInt32LE(4, end + 16);
    assert.throws(function() {
        readZip(buffer);
    }, /Broken central directory/);
});

test("a zip of nothing is still a zip", async () => {
    const buffer = await build([]);
    assert.equal(buffer.length, 22);
    assert.deepEqual(readZip(buffer), []);
});
