"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";

// first-party dependencies
import { buildConfFile, buildPaint, injectAppearance, minifyScript, minifyStyle, minifyMarkup } from "../src/server/building.js";

const repoPath = path.resolve(import.meta.dirname, "..");

// the minifiers are hand-written scanners and a throw only downgrades the file
// to a verbatim copy, so a wrong-but-quiet result never reaches the build log

//
// minifyStyle
//
test("minifyStyle drops comments and collapses whitespace", () => {
    assert.equal(minifyStyle("/* header */\n.a  ,  .b  {  color: red ;  }\n"), ".a,.b{color:red}");
});

test("minifyStyle drops the semicolon closing a block", () => {
    assert.equal(minifyStyle("a{color:red;}"), "a{color:red}");
    assert.equal(minifyStyle("a{color:red;background:blue;}"), "a{color:red;background:blue}");
});

test("minifyStyle copies string literals verbatim", () => {
    // braces, semicolons and comment markers inside a string are content, not syntax
    assert.equal(minifyStyle("a{content:\"{;} /* x */\"}"), "a{content:\"{;} /* x */\"}");
    assert.equal(minifyStyle("a{content:'  two  spaces  '}"), "a{content:'  two  spaces  '}");
});

test("minifyStyle keeps an escaped quote inside a string", () => {
    assert.equal(minifyStyle("a{content:\"say \\\" hi\"}"), "a{content:\"say \\\" hi\"}");
});

test("minifyStyle keeps the space a descendant selector needs", () => {
    // "a :hover" and "a:hover" are different selectors
    assert.equal(minifyStyle("a :hover { color: red; }"), "a :hover{color:red}");
    assert.equal(minifyStyle("a:hover { color: red; }"), "a:hover{color:red}");
});

test("minifyStyle survives an unterminated comment and string", () => {
    assert.equal(minifyStyle("a{color:red} /* trailing"), "a{color:red}");
    assert.doesNotThrow(function() {
        minifyStyle("a{content:\"unterminated}");
    });
});

test("minifyStyle is idempotent", () => {
    const source = "/* c */\n.a , .b {  color : red ;  }\n@media (min-width: 40em) { .c { margin: 0 } }";
    const once = minifyStyle(source);
    assert.equal(minifyStyle(once), once);
});

//
// minifyMarkup
//
test("minifyMarkup drops comments and collapses whitespace", () => {
    assert.equal(minifyMarkup("<p>  a  </p><!-- note -->\n<p>b</p>"), "<p> a </p> <p>b</p>");
});

test("minifyMarkup collapses the whitespace between attributes", () => {
    assert.equal(minifyMarkup("<a   id=\"x\"    class=\"y\"  >t</a>"), "<a id=\"x\" class=\"y\">t</a>");
});

test("minifyMarkup keeps a > inside an attribute value", () => {
    // the scanner has to skip quoted values when it looks for the end of the tag
    assert.equal(minifyMarkup("<a title=\"a > b\" id=\"x\">t</a>"), "<a title=\"a > b\" id=\"x\">t</a>");
});

test("minifyMarkup keeps the content of raw text elements", () => {
    assert.equal(minifyMarkup("<pre>  keep\n  me  </pre>"), "<pre>  keep\n  me  </pre>");
    assert.equal(minifyMarkup("<textarea>  a  b  </textarea>"), "<textarea>  a  b  </textarea>");
});

test("minifyMarkup routes inline style and script through their own minifiers", () => {
    // "color :red" keeps the space the CSS scanner leaves in front of a colon
    assert.equal(minifyMarkup("<style>  a  {  color : red ;  }  </style>"), "<style>a{color :red}</style>");

    const built = minifyMarkup("<script type=\"module\">const value = 1; export {value};</script>");
    assert.match(built, /^<script type="module">/);
    assert.match(built, /export\{/);
    assert.equal(built.includes("const value = 1"), false);
});

test("minifyMarkup leaves an empty raw element alone", () => {
    assert.equal(minifyMarkup("<script src=\"/src/index.js\" type=\"module\"></script>"), "<script src=\"/src/index.js\" type=\"module\"></script>");
});

test("minifyMarkup survives an unterminated tag and comment", () => {
    assert.doesNotThrow(function() {
        minifyMarkup("<p>text<span");
    });
    assert.doesNotThrow(function() {
        minifyMarkup("<p>text</p><!-- unterminated");
    });
});

test("minifyMarkup is idempotent", () => {
    const source = "<!DOCTYPE html>\n<html>\n  <head>  <title>  T  </title>  </head>\n  <body>\n    <p>  a  </p>\n    <pre>  raw  </pre>\n  </body>\n</html>";
    const once = minifyMarkup(source);
    assert.equal(minifyMarkup(once), once);
});

test("minifyMarkup leaves a doubled space where it dropped a comment", () => {
    // current behaviour, not a target: the whitespace on both sides of the
    // comment collapses separately, so the output is one space short of minimal
    assert.equal(minifyMarkup("<body>\n  <!-- c -->\n  <p>a</p>\n</body>"), "<body>  <p>a</p> </body>");
});

//
// minifyScript
//
test("minifyScript minifies a module", () => {
    const built = minifyScript("const value = 1; export {value};", true);
    assert.match(built, /export\{/);
    assert.equal(built.includes("const value = 1"), false);
});

test("minifyScript keeps require and module.exports in script mode", () => {
    // the Electron shell stays CommonJS, so the build parses it with isModule=false
    const built = minifyScript("const p = require(\"path\"); module.exports = p;", false);
    assert.match(built, /require\("path"\)/);
    assert.match(built, /module\.exports/);
});

test("minifyScript parses module syntax whichever mode it is given", () => {
    // the isModule flag does not gate ESM syntax, so an Electron file that grew
    // an import still minifies here and only fails once Electron requires it
    assert.match(minifyScript("export const value = 1;", false), /export\{/);
});

test("minifyScript throws on a syntax error", () => {
    // buildFile turns this into a verbatim copy, it must not return broken code
    assert.throws(function() {
        minifyScript("const = ;", true);
    });
});

//
// buildConfFile
//
// the one generated file of a build: what a client is handed as the address of
// the two servers, which behind a proxy is not what either one listens on
const confSections = function() {
    return {
        "http": {"domain": "localhost", "port": 8443},
        "ws": {"domain": "localhost", "port": 8444}
    };
};

test("buildConfFile hands out the configured addresses when nothing proxies them", async () => {
    const built = JSON.parse(await buildConfFile(confSections()));
    assert.deepEqual(built["http"], {"domain": "localhost", "port": 8443});
    assert.deepEqual(built["ws"], {"domain": "localhost", "port": 8444});
});

test("buildConfFile hands out the proxy address of each server", async () => {
    const conf = confSections();
    conf["http"]["proxy"] = {"domain": "botto.hu", "port": 443};
    conf["ws"]["proxy"] = {"domain": "botto.hu", "port": 443};
    const built = JSON.parse(await buildConfFile(conf));
    assert.deepEqual(built["http"], {"domain": "botto.hu", "port": 443});
    assert.deepEqual(built["ws"], {"domain": "botto.hu", "port": 443});
});

test("buildConfFile gives the ws server the proxied host of the http one", async () => {
    // the ws section carries no proxy of its own, so only the host is shared
    const conf = confSections();
    conf["http"]["proxy"] = {"domain": "botto.hu", "port": 443};
    const built = JSON.parse(await buildConfFile(conf));
    assert.deepEqual(built["ws"], {"domain": "botto.hu", "port": 8444});
});

test("buildConfFile still points at a remote ws server over a proxy", async () => {
    const conf = confSections();
    conf["http"]["proxy"] = {"domain": "botto.hu", "port": 443};
    conf["http"]["remote"] = {"host": "ws.example.com", "port": 444};
    delete conf["ws"];
    const built = JSON.parse(await buildConfFile(conf));
    assert.deepEqual(built["ws"], {"domain": "ws.example.com", "port": 444});
});

test("buildConfFile hands the client the configured appearance", async () => {
    const conf = confSections();
    conf["http"]["appearance"] = {"name": {"en": "Streamer"}, "color": "#1a2b3c", "theme": "dark"};
    const built = JSON.parse(await buildConfFile(conf));
    assert.deepEqual(built["appearance"], {"name": {"en": "Streamer"}, "color": "#1a2b3c", "theme": "dark"});
});

test("buildConfFile hands the default colour and theme when none is configured", async () => {
    const defaults = {"color": "#006e1c", "theme": "auto"};
    assert.deepEqual(JSON.parse(await buildConfFile(confSections()))["appearance"], defaults);

    // a ws only configuration has no http section to hold one
    const conf = confSections();
    delete conf["http"];
    assert.deepEqual(JSON.parse(await buildConfFile(conf))["appearance"], defaults);

    // and a configuration naming only one of them keeps the default of the other
    const partial = confSections();
    partial["http"]["appearance"] = {"theme": "dark"};
    assert.deepEqual(JSON.parse(await buildConfFile(partial))["appearance"], {"color": "#006e1c", "theme": "dark"});
});

//
// buildPaint / injectAppearance
//
// the palette the page paints with before its first module runs, which has to
// be the one the client goes on to build - or the colour switches under it
test("buildPaint builds the configured palette the way beercss writes it", async () => {
    const conf = confSections();
    conf["http"]["appearance"] = {"color": "#b3261e", "theme": "dark"};
    const paint = await buildPaint(conf);
    assert.equal(paint["color"], "#b3261e");
    assert.equal(paint["mode"], "dark");
    // beercss's own names, kebab-cased from the generator's camelCase keys
    assert.match(paint["light"], /^--primary:#[0-9a-f]{6};/);
    assert.match(paint["dark"], /--on-primary-container:#[0-9a-f]{6};/);
    assert.notEqual(paint["light"], paint["dark"]);
});

test("buildPaint paints the default colour and theme when none is configured", async () => {
    const paint = await buildPaint(confSections());
    assert.equal(paint["color"], "#006e1c");
    assert.equal(paint["mode"], "auto");
});

test("injectAppearance writes the paint into the built page, escaped", async () => {
    const source = await fs.readFile(path.join(repoPath, "src", "client", "web", "index.html"), "utf8");
    const page = {"path": "index.html", "data": Buffer.from(minifyMarkup(source), "utf8")};
    const paint = {"color": "#b3261e", "mode": "dark", "light": "--primary:#b4271f;", "dark": "--primary:#ffb4aa;"};
    injectAppearance([page], paint);

    const html = page["data"].toString("utf8");
    const content = /<meta name="appearance" content="([^"]*)">/.exec(html)?.[1];
    assert.equal(typeof content, "string");
    const unescaped = content.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    assert.deepEqual(JSON.parse(unescaped), paint);

    // the script that reads it survives the minifier, ahead of the loading layer
    assert.ok(html.indexOf("localStorage") !== -1);
    assert.ok(html.indexOf("localStorage") < html.indexOf("dialog-loading"));
});

test("buildPaint carries the configured name, and none where there is none", async () => {
    const conf = confSections();
    assert.equal("name" in await buildPaint(conf), false);
    conf["http"]["appearance"] = {"name": {"en": "Streamer", "hu": "Közvetítő"}};
    assert.deepEqual((await buildPaint(conf))["name"], {"en": "Streamer", "hu": "Közvetítő"});
});

test("injectAppearance makes the configured name the static title, escaped", async () => {
    const source = await fs.readFile(path.join(repoPath, "src", "client", "web", "index.html"), "utf8");
    const built = function(paint) {
        const page = {"path": "index.html", "data": Buffer.from(minifyMarkup(source), "utf8")};
        injectAppearance([page], paint);
        return /<title>([^<]*)<\/title>/.exec(page["data"].toString("utf8"))[1];
    };
    const paint = {"color": "#006e1c", "mode": "auto", "light": "", "dark": ""};

    // English where it is given, the first one where it is not
    assert.equal(built({...paint, "name": {"hu": "Közvetítő", "en": "Tom & <Jerry>"}}), "Tom &amp; &lt;Jerry&gt;");
    assert.equal(built({...paint, "name": {"hu": "Közvetítő", "de": "Übertragung"}}), "Közvetítő");

    // and the page's own where nothing is configured
    assert.equal(built(paint), "Desktop Streamer");

    // a "$" in a name is text, not a replacement pattern
    assert.equal(built({...paint, "name": {"en": "Pay$` Me $& $$"}}), "Pay$` Me $&amp; $$");
});

test("injectAppearance refuses a page with no appearance meta", () => {
    const page = {"path": "index.html", "data": Buffer.from("<html><head></head></html>", "utf8")};
    assert.throws(() => injectAppearance([page], {}), /No appearance meta/);
});

test("buildConfFile names the dists of the compile it belongs to", async () => {
    const built = JSON.parse(await buildConfFile(confSections(), [{"os": "win32", "arch": "x64"}]));
    assert.deepEqual(built["clients"], ["win32-x64.zip"]);
    assert.equal(typeof built["version"], "string");
});
