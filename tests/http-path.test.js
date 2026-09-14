"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

// first-party dependencies
import serverHTTP from "../src/server/http.js";

// requestPath and resolveInBase are the whole guard between a request and the
// filesystem, importing the module only builds the instance, it starts nothing

const basePath = "./tmp/web";
const base = path.resolve(basePath);

//
// requestPath
//
test("requestPath drops the query and the hash", () => {
    assert.equal(serverHTTP.requestPath("/src/router.js?v=2"), "src/router.js");
    assert.equal(serverHTTP.requestPath("/src/router.js#top"), "src/router.js");
    assert.equal(serverHTTP.requestPath("/src/router.js?v=2#top"), "src/router.js");
});

test("requestPath strips every leading slash", () => {
    assert.equal(serverHTTP.requestPath("/index.html"), "index.html");
    assert.equal(serverHTTP.requestPath("///index.html"), "index.html");
    assert.equal(serverHTTP.requestPath("/"), "");
});

test("requestPath decodes percent encoding", () => {
    assert.equal(serverHTTP.requestPath("/media/icon%20copy.svg"), "media/icon copy.svg");

    // an encoded traversal decodes here, so resolveInBase is what has to catch it
    assert.equal(serverHTTP.requestPath("/%2e%2e%2f%2e%2e%2fpackage.json"), "../../package.json");
});

test("requestPath serves an invalid encoding as it arrived", () => {
    assert.equal(serverHTTP.requestPath("/%zz"), "%zz");
});

//
// resolveInBase
//
test("resolveInBase resolves a path inside the base", () => {
    assert.equal(serverHTTP.resolveInBase(basePath, "index.html"), path.join(base, "index.html"));
    assert.equal(serverHTTP.resolveInBase(basePath, "media/icon.svg"), path.join(base, "media", "icon.svg"));
    assert.equal(serverHTTP.resolveInBase(basePath, ""), base);
});

test("resolveInBase refuses a path leaving the base", () => {
    assert.equal(serverHTTP.resolveInBase(basePath, "../package.json"), undefined);
    assert.equal(serverHTTP.resolveInBase(basePath, "../../etc/passwd"), undefined);
    assert.equal(serverHTTP.resolveInBase(basePath, "media/../../package.json"), undefined);
});

test("resolveInBase refuses a sibling folder sharing the base name", () => {
    // "tmp/web-secret" starts with "tmp/web" as a string but is not inside it
    assert.equal(serverHTTP.resolveInBase(basePath, "../web-secret/key.pem"), undefined);
});

test("resolveInBase refuses an absolute path", () => {
    const outside = path.resolve("/etc/passwd");
    assert.equal(serverHTTP.resolveInBase(basePath, outside), undefined);
});

//
// the two together, the way the request handler runs them
//
test("a request cannot reach outside the served folder", () => {
    const attempts = [
        "/../package.json",
        "/../../etc/passwd",
        "/%2e%2e%2fpackage.json",
        "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
        "/media/%2e%2e%2f%2e%2e%2fpackage.json"
    ];
    for (const url of attempts) {
        const resolved = serverHTTP.resolveInBase(basePath, serverHTTP.requestPath(url));
        assert.equal(resolved, undefined, "escaped the base path: " + url);
    }
});

//
// isRoutePath
//
// the SPA fallback answers a route with index.html, a missing asset has to stay
// a 404 or a mistyped import() specifier arrives as HTML and fails with a MIME
// error instead of a plain missing file
test("isRoutePath accepts the paths the client routes on", () => {
    for (const url of ["", "new", "downloads", "devices", "room/abc123", "login"]) {
        assert.equal(serverHTTP.isRoutePath(url), true, "should be a route: " + url);
    }
});

test("isRoutePath refuses anything with a file extension", () => {
    for (const url of ["index.html", "favicon.ico", "some/where/thing.js", "media/icon.svg"]) {
        assert.equal(serverHTTP.isRoutePath(url), false, "should not be a route: " + url);
    }
});

test("isRoutePath refuses the folders holding the client assets", () => {
    for (const url of ["ui/devices", "src/nothing", "libs/beercss", "media/nothing"]) {
        assert.equal(serverHTTP.isRoutePath(url), false, "should not be a route: " + url);
    }
});

//
// isNotModified
//
const fileData = {"etag": "\"index.html1234\"", "lastModified": "Wed, 21 Oct 2015 07:28:00 GMT"};

test("isNotModified answers a matching ETag", () => {
    assert.equal(serverHTTP.isNotModified({"headers": {"if-none-match": fileData["etag"]}}, fileData), true);
    assert.equal(serverHTTP.isNotModified({"headers": {"if-none-match": "\"other5\", " + fileData["etag"]}}, fileData), true);
    assert.equal(serverHTTP.isNotModified({"headers": {"if-none-match": "*"}}, fileData), true);
});

test("isNotModified refuses an ETag that does not match", () => {
    assert.equal(serverHTTP.isNotModified({"headers": {"if-none-match": "\"index.html9\""}}, fileData), false);

    // an explicit ETag wins over the date, the file changed back to the same size
    assert.equal(serverHTTP.isNotModified({
        "headers": {"if-none-match": "\"index.html9\"", "if-modified-since": fileData["lastModified"]}
    }, fileData), false);
});

test("isNotModified falls back to the date when there is no ETag", () => {
    assert.equal(serverHTTP.isNotModified({"headers": {"if-modified-since": fileData["lastModified"]}}, fileData), true);
    assert.equal(serverHTTP.isNotModified({"headers": {"if-modified-since": "Thu, 22 Oct 2015 07:28:00 GMT"}}, fileData), true);
    assert.equal(serverHTTP.isNotModified({"headers": {"if-modified-since": "Tue, 20 Oct 2015 07:28:00 GMT"}}, fileData), false);
});

test("isNotModified sends the file when the request asks for nothing", () => {
    assert.equal(serverHTTP.isNotModified({"headers": {}}, fileData), false);
    assert.equal(serverHTTP.isNotModified({"headers": {"if-modified-since": "not a date"}}, fileData), false);
});

//
// the two together, the way the request handler runs them
//
test("an ordinary request still resolves", () => {
    const attempts = ["/", "/index.html", "/src/router.js?v=1", "/media/icon.svg", "///media/icon.svg"];
    for (const url of attempts) {
        const resolved = serverHTTP.resolveInBase(basePath, serverHTTP.requestPath(url));
        assert.notEqual(resolved, undefined, "should have resolved: " + url);
        assert.equal(resolved.startsWith(base), true);
    }
});
