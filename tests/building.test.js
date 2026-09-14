"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { minifyScript, minifyStyle, minifyMarkup } from "../src/server/building.js";

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
