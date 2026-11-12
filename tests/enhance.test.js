"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

// first-party dependencies
import { KINDS, GRAPHS, OFF, TILE_STEP, HALO, CONDITION_NAME, DEFAULT_CONDITION, schedule, presentDelay, conditionOf, planTiles, isSameShape, normalizeOptions, isAnyOn, modelsFor, kindsFor, feedsOf, bytesOf, patchInputDims, readInputDims, readInputNames } from "../src/client/web/src/room/stream-enhance.js";

const modelsPath = path.resolve(import.meta.dirname, "..", "src", "client", "web", "media", "models");
const runtimePath = path.resolve(import.meta.dirname, "..", "src", "client", "web", "libs", "onnxruntime");

// The enhancer runs in the decoder's worker on a GPU the test runner has not
// got, but what it decides *before* touching one is plain arithmetic: which
// pictures one arriving frame turns into and where each sits in the frame
// interval, which models a choice needs, and how big a picture is on the GPU.
// That is what is proved here - the tiling a frame is cut into as well, since
// a model is never handed a whole frame, and the condition a told upscaler is
// handed beside the picture - and the one thing it does to a model file:
// the WebGL provider runs static shapes only, so the symbolic input
// dimensions of a graph are written as the frame's in the protobuf bytes
// before a session is made of it. The graphs themselves are run here too,
// through the runtime the client loads, on the one provider it has under
// Node - the CPU's - which answers what the GPU's does to a millionth.

test("the options are three booleans whatever was handed in", () => {
    assert.deepEqual(KINDS, ["upscale", "interpolate", "extrapolate"]);
    assert.deepEqual(normalizeOptions(undefined), OFF);
    assert.deepEqual(normalizeOptions({"upscale": 1, "interpolate": "yes"}), OFF);
    assert.deepEqual(normalizeOptions({"upscale": true, "other": true}), {"upscale": true, "interpolate": false, "extrapolate": false});
    assert.equal(isAnyOn(OFF), false);
    assert.equal(isAnyOn({...OFF, "extrapolate": true}), true);
});

test("nothing on is the frame itself, now", () => {
    assert.deepEqual(schedule(OFF, true), [{"kind": "frame", "at": 0}]);
    assert.deepEqual(schedule({...OFF, "upscale": true}, true), [{"kind": "frame", "at": 0}]);
});

test("a two-frame model waits for its second frame", () => {
    // the first frame of a stream has nothing to pair with, so it is drawn as
    // it is whatever is on
    assert.deepEqual(schedule({...OFF, "interpolate": true}, false), [{"kind": "frame", "at": 0}]);
    assert.deepEqual(schedule({...OFF, "extrapolate": true}, false), [{"kind": "frame", "at": 0}]);
});

test("the interpolated frame stands in before the real one, the extrapolated after it", () => {
    assert.deepEqual(schedule({...OFF, "interpolate": true}, true), [
        {"kind": "interpolate", "graph": "interpolate", "at": 0},
        {"kind": "frame", "at": 1 / 2}
    ]);
    assert.deepEqual(schedule({...OFF, "extrapolate": true}, true), [
        {"kind": "frame", "at": 0},
        {"kind": "extrapolate", "graph": "extrapolate", "at": 1 / 2}
    ]);
    // both on is three pictures an interval: the interpolated one two thirds of
    // the way to the real one and the extrapolated one a third past it, which
    // the 2x graphs (half way, half past) do not make - so the 3x pair
    assert.deepEqual(schedule({"upscale": true, "interpolate": true, "extrapolate": true}, true), [
        {"kind": "interpolate", "graph": "interpolate3x", "at": 0},
        {"kind": "frame", "at": 1 / 3},
        {"kind": "extrapolate", "graph": "extrapolate3x", "at": 2 / 3}
    ]);
});

test("every schedule presents the real frame once and in order", () => {
    for (const upscale of [false, true]) {
        for (const interpolate of [false, true]) {
            for (const extrapolate of [false, true]) {
                for (const hasPrevious of [false, true]) {
                    const steps = schedule({"upscale": upscale, "interpolate": interpolate, "extrapolate": extrapolate}, hasPrevious);
                    const real = steps.filter((step) => step["kind"] === "frame");
                    assert.equal(real.length, 1);
                    for (let i = 1; i < steps.length; i++) {
                        assert.equal(steps[i]["at"] > steps[i - 1]["at"], true, "steps out of order");
                    }
                    for (const step of steps.filter((step) => step["kind"] !== "frame")) {
                        assert.equal(GRAPHS.includes(step["graph"]), true, step["graph"] + " is a graph the client has");
                    }
                    assert.equal(steps[0]["at"], 0, "the first picture is drawn at once");
                    assert.equal(steps[steps.length - 1]["at"] < 1, true, "nothing is drawn after the next frame is due");
                }
            }
        }
    }
});

test("a picture's place is counted from the frame's first picture, not from when it was made", () => {
    // all three on at 30 fps, every step costing 26 ms: the first picture is
    // drawn at 26, so the real frame belongs at 26 + 11 and the predicted one
    // at 26 + 22 - whatever the steps between cost
    const interval = 33;
    const anchor = 26;
    const at = schedule({"upscale": true, "interpolate": true, "extrapolate": true}, true).map((step) => step["at"]);
    assert.equal(presentDelay(at[0], interval, anchor, anchor), 0);
    // made at 30, due at 37: it waits the 7 left, not a third of the interval
    assert.equal(presentDelay(at[1], interval, anchor, 30), 7);
    // made at 40, due at 48
    assert.equal(presentDelay(at[2], interval, anchor, 40), 8);
    // made after its place has passed: drawn at once, never a negative wait
    assert.equal(presentDelay(at[2], interval, anchor, 78), 0);
    // so every picture is due inside the interval of its frame, however long
    // its steps took
    for (let now = anchor; now < anchor + 3 * interval; now++) {
        for (const place of at) {
            assert.equal(now + presentDelay(place, interval, anchor, now) <= Math.max(now, anchor + place * interval), true);
        }
    }
});

test("only the models that are on are loaded, and both frame generators as their 3x pair", () => {
    assert.deepEqual(modelsFor(OFF), []);
    assert.deepEqual(modelsFor({"upscale": true, "interpolate": false, "extrapolate": true}), ["upscale", "extrapolate"]);
    assert.deepEqual(modelsFor({"upscale": true, "interpolate": true, "extrapolate": true}), ["upscale", "interpolate3x", "extrapolate3x"]);
    for (const upscale of [false, true]) {
        for (const interpolate of [false, true]) {
            for (const extrapolate of [false, true]) {
                const options = {"upscale": upscale, "interpolate": interpolate, "extrapolate": extrapolate};
                const needed = schedule(options, true).filter((step) => step["kind"] !== "frame").map((step) => step["graph"]);
                for (const graph of needed) {
                    assert.equal(modelsFor(options).includes(graph), true, graph + " is loaded before it runs");
                }
            }
        }
    }
});

test("the frame generators run on WebGPU only", () => {
    // they read with GridSample, which the WebGL provider has not got
    assert.deepEqual(kindsFor("webgpu"), KINDS);
    assert.deepEqual(kindsFor("webgl"), ["upscale"]);
    assert.deepEqual(kindsFor(""), []);
});

test("a picture's bytes are its float32 count rounded to 16", () => {
    assert.equal(bytesOf([1, 3, 2, 2]), 48);
    assert.equal(bytesOf([1, 3, 1, 1]), 16);         // 12 bytes, read in 16
    assert.equal(bytesOf([1, 3, 1080, 1920]), 1080 * 1920 * 3 * 4);
    assert.equal(bytesOf([1, 6, 3, 3]) % 16, 0);
});

// the upscaler is the trained one, told a frame's condition as a second
// input of three numbers; the frame generators, 2x and 3x, take two frames
const PICTURE_DIMS = ["N", 3, "H", "W"];
const INPUT_DIMS = {
    "upscale": [PICTURE_DIMS, [3]],
    "interpolate": [PICTURE_DIMS, PICTURE_DIMS],
    "extrapolate": [PICTURE_DIMS, PICTURE_DIMS],
    "interpolate3x": [PICTURE_DIMS, PICTURE_DIMS],
    "extrapolate3x": [PICTURE_DIMS, PICTURE_DIMS]
};

test("every graph is there and takes a batch of tiles of any size, one frame per input", async () => {
    assert.deepEqual(GRAPHS, Object.keys(INPUT_DIMS));
    for (const kind of GRAPHS) {
        const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, kind + ".onnx")));
        assert.deepEqual(readInputDims(bytes), INPUT_DIMS[kind], kind + " takes " + (kind === "upscale" ? "one frame and its condition" : "two frames"));
    }
});

test("every graph is fed by the input names it declares, its pictures oldest first", async () => {
    for (const graph of GRAPHS) {
        const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, graph + ".onnx")));
        const declared = readInputNames(bytes).filter((name) => name !== CONDITION_NAME);
        const pictures = declared.map((name, index) => ({"index": index}));
        const feeds = feedsOf(graph, pictures);
        assert.deepEqual(Object.keys(feeds), declared, graph + " is fed what it declares");
        assert.deepEqual(Object.values(feeds), pictures, graph + " is fed its pictures in order");
    }
    assert.deepEqual(Object.keys(feedsOf("interpolate", [{}, {}])), ["previous", "current"]);
    assert.throws(() => feedsOf("upscale", [{}, {}]), /takes 1 pictures, not 2/);
    assert.throws(() => feedsOf("extrapolate", [{}]), /takes 2 pictures, not 1/);
});

test("the symbolic dimensions of every input are written as the batch's, and nothing else moves", async () => {
    for (const kind of GRAPHS) {
        const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, kind + ".onnx")));
        const patched = patchInputDims(bytes, [36, 188, 328]);
        const expected = INPUT_DIMS[kind].map(function(dims) {
            return (dims.length === 4 ? [36, 3, 188, 328] : dims);
        });
        assert.deepEqual(readInputDims(patched), expected);

        // the fixed dimensions were left as they were, and the file is one
        // byte per picture input shorter: a one letter name (key, length,
        // letter) is three bytes, and so is a value under 16384 (key, two byte
        // varint) - the batch under 128 is two
        const pictures = INPUT_DIMS[kind].filter((dims) => dims.length === 4).length;
        assert.equal(patched.length, bytes.length - pictures, kind + ": three names became three values per picture input");
        assert.deepEqual(readInputDims(patchInputDims(patched, [7, 7, 7])), expected, "a fixed dimension is not rewritten");
    }
});

test("a varint over one byte round-trips through the patch", async () => {
    const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, "upscale.onnx")));
    assert.deepEqual(readInputDims(patchInputDims(bytes, [144, 2160, 3840]))[0], [144, 3, 2160, 3840]);
    assert.deepEqual(readInputDims(patchInputDims(bytes, [1, 16, 300000]))[0], [1, 3, 16, 300000]);
});

// the frame's own edge is given the halo as well, read again from its edge
// pixels, so no kept pixel is ever next to a model's padding
test("a frame is tiled so every pixel is kept once, inside a halo, and no window reaches further past the frame than one", () => {
    for (const [width, height] of [[1920, 1080], [1280, 720], [1000, 700], [500, 200], [328, 188], [64, 32]]) {
        const plan = planTiles(width, height);
        const covered = new Uint8Array(width * height);
        for (const tile of plan["tiles"]) {
            assert.equal(tile["ix"] >= -HALO && tile["iy"] >= -HALO, true, "a window more than the halo past the frame");
            assert.equal(tile["ix"] + plan["tileWidth"] <= width + HALO && tile["iy"] + plan["tileHeight"] <= height + HALO, true, "a window more than the halo past the frame");
            assert.equal(tile["ox"] >= HALO && tile["oy"] >= HALO, true, "a kept region without its halo");
            assert.equal(tile["ox"] + tile["w"] + HALO <= plan["tileWidth"] && tile["oy"] + tile["h"] + HALO <= plan["tileHeight"], true, "a kept region without its halo");
            for (let y = tile["y"]; y < tile["y"] + tile["h"]; y++) {
                for (let x = tile["x"]; x < tile["x"] + tile["w"]; x++) {
                    covered[y * width + x]++;
                }
            }
        }
        assert.equal(covered.every((count) => count === 1), true, width + "x" + height + " is not covered exactly once");
    }
});

test("every 16:9 frame from 720p up is whole steps, each with its halo", () => {
    for (const [width, height, across, down] of [[1280, 720, 4, 4], [1920, 1080, 6, 6], [2560, 1440, 8, 8], [3840, 2160, 12, 12]]) {
        const plan = planTiles(width, height);
        assert.equal(plan["tiles"].length, across * down);
        assert.equal(plan["tileWidth"], TILE_STEP["width"] + 2 * HALO);
        assert.equal(plan["tileHeight"], TILE_STEP["height"] + 2 * HALO);
        assert.equal(plan["across"], across);
        for (const tile of plan["tiles"]) {
            assert.equal(tile["w"], TILE_STEP["width"]);
            assert.equal(tile["h"], TILE_STEP["height"]);
        }
        // the row-major order the tiles are batched in is the order a frame
        // pixel finds its tile by division, which is what the draw relies on
        plan["tiles"].forEach(function(tile, index) {
            assert.equal(Math.floor(tile["y"] / TILE_STEP["height"]) * across + Math.floor(tile["x"] / TILE_STEP["width"]), index);
        });
        // every tile has its halo on every side, an edge tile's reaching past
        // the frame
        for (const tile of plan["tiles"]) {
            assert.deepEqual([tile["ox"], tile["oy"]], [HALO, HALO]);
        }
        assert.deepEqual([plan["tiles"][0]["ix"], plan["tiles"][0]["iy"]], [-HALO, -HALO]);
        const last = plan["tiles"][plan["tiles"].length - 1];
        assert.deepEqual([last["ix"] + plan["tileWidth"], last["iy"] + plan["tileHeight"]], [width + HALO, height + HALO]);
    }
});

test("a tile kept short at the far edge slides its window back, not out", () => {
    // 1366 is four steps and 86 pixels: the last window ends the halo past the frame
    const plan = planTiles(1366, 768);
    const last = plan["tiles"][plan["across"] - 1];
    assert.deepEqual([last["x"], last["w"]], [1280, 86]);
    assert.equal(last["ix"] + plan["tileWidth"], 1366 + HALO);
    assert.equal(last["ox"], 1280 - last["ix"]);
});

// a two-frame model is only ever fed two pictures of one size: a host that
// changed resolution is a previous picture that pairs with nothing
test("pictures of another frame size are not the same shape", () => {
    const picture = function(width, height) {
        return {"plan": planTiles(width, height)};
    };
    assert.equal(isSameShape(picture(1280, 720), picture(1280, 720)), true);
    assert.equal(isSameShape(picture(1280, 720), picture(1920, 1080)), false);
    // the same tile grid, a different frame: 1280x720 and 1270x720 are both 4x4 tiles
    assert.equal(isSameShape(picture(1280, 720), picture(1270, 720)), false);
    assert.equal(isSameShape(null, picture(1280, 720)), false);
});

test("a frame smaller than a tile is one tile of its own size and the halo", () => {
    const plan = planTiles(64, 32);
    assert.equal(plan["tiles"].length, 1);
    assert.deepEqual([plan["tileWidth"], plan["tileHeight"]], [64 + 2 * HALO, 32 + 2 * HALO]);
    assert.deepEqual(plan["tiles"][0], {"x": 0, "y": 0, "w": 64, "h": 32, "ix": -HALO, "iy": -HALO, "ox": HALO, "oy": HALO});
});

// what ./stream-h264.js read of a frame, as the three numbers a told graph is
// handed: the slice QP / 51, the loop filter, I frame
test("a frame's condition is its QP over 51, its loop filter and whether it is an I frame", () => {
    assert.equal(CONDITION_NAME, "condition");
    assert.deepEqual(conditionOf({"qp": 30.6, "type": "P", "isDeblocked": true, "slices": 1}), [30.6 / 51, 1, 0]);
    assert.deepEqual(conditionOf({"qp": 22, "type": "I", "isDeblocked": false, "slices": 6}), [22 / 51, 0, 1]);
    assert.deepEqual(conditionOf({"qp": 40, "type": "B", "isDeblocked": true}), [40 / 51, 1, 0]);
    // a QP outside H.264's range is the edge of it
    assert.deepEqual(conditionOf({"qp": 60, "type": "P", "isDeblocked": false}), [1, 0, 0]);
    assert.deepEqual(conditionOf({"qp": -3, "type": "P", "isDeblocked": false}), [0, 0, 0]);
});

test("a frame the reader could not read has no condition, and the default is a middle one", () => {
    for (const picture of [null, undefined, {}, {"qp": null}, {"qp": NaN}, {"qp": "30"}]) {
        assert.equal(conditionOf(picture), null);
    }
    assert.equal(DEFAULT_CONDITION.length, 3);
    assert.deepEqual([...DEFAULT_CONDITION], [30 / 51, 1, 0]);
});

//
// the graphs, run
//
// Through the runtime the client loads, on its CPU (WebAssembly) provider:
// what a re-exported graph has to keep doing for the client to stay right -
// answer a batch of tiles, show the moment schedule() presents it at, give a
// still picture back, read no further than the halo, and leave the picture's
// edges alone.
let runtime = null;
const loadRuntime = function() {
    if (runtime === null) {
        runtime = import(pathToFileURL(path.join(runtimePath, "ort.all.min.mjs")).href).then(function(ort) {
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.wasmPaths = pathToFileURL(runtimePath + path.sep).href;
            ort.env.logLevel = "error";
            return ort;
        });
    }
    return runtime;
};

const sessions = new Map();
const sessionOf = async function(graph, bytes = null) {
    const ort = await loadRuntime();
    const key = (bytes === null ? graph : graph + "|patched");
    if (sessions.has(key) === false) {
        const model = bytes ?? new Uint8Array(await fs.readFile(path.join(modelsPath, graph + ".onnx")));
        sessions.set(key, await ort.InferenceSession.create(model, {"executionProviders": ["wasm"]}));
    }
    return sessions.get(key);
};

// pictures as the client hands them over: {dims, data}, float32 NCHW, oldest
// first, to the inputs the MODELS table names
const runGraph = async function(graph, pictures, condition = DEFAULT_CONDITION, session = null) {
    const ort = await loadRuntime();
    const held = session ?? await sessionOf(graph);
    const feeds = {};
    for (const [input, picture] of Object.entries(feedsOf(graph, pictures))) {
        feeds[input] = new ort.Tensor("float32", picture["data"], picture["dims"]);
    }
    if (held.inputNames.includes(CONDITION_NAME) === true) {
        feeds[CONDITION_NAME] = new ort.Tensor("float32", Float32Array.from(condition), [3]);
    }
    const output = (await held.run(feeds))["output"];
    return {"dims": [...output.dims], "data": output.data};
};

// a picture that is a pure function of its position - smooth, and nowhere
// periodic within a tile, so a motion search has the one answer - so one
// moved by whole pixels is exactly the same picture read further along
const sceneAt = function(x, y) {
    return [
        0.5 + 0.25 * Math.sin(x / 7) * Math.cos(y / 11) + 0.15 * Math.sin((x + 2 * y) / 23),
        0.5 + 0.3 * Math.sin(x / 13 + y / 5),
        0.5 + 0.35 * Math.sin(x / 37 + y / 53)
    ];
};
// {width, height, data}: planar float RGB, the scene from (left, top) or one level
const render = function(width, height, left, top, level = null) {
    const count = width * height;
    const data = new Float32Array(3 * count);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const rgb = (level === null ? sceneAt(x + left, y + top) : [level, level, level]);
            for (let c = 0; c < 3; c++) {
                data[c * count + y * width + x] = rgb[c];
            }
        }
    }
    return {"width": width, "height": height, "data": data};
};
// an image read at (x, y) with its edge pixels read again past it, as the
// enhancer's windows read a frame
const readClamped = function(image, c, x, y) {
    const row = Math.min(image["height"] - 1, Math.max(0, y));
    const column = Math.min(image["width"] - 1, Math.max(0, x));
    return image["data"][(c * image["height"] + row) * image["width"] + column];
};
const asBatch = function(images) {
    const data = new Float32Array(images.reduce((total, image) => total + image["data"].length, 0));
    let offset = 0;
    for (const image of images) {
        data.set(image["data"], offset);
        offset += image["data"].length;
    }
    return {"dims": [images.length, 3, images[0]["height"], images[0]["width"]], "data": data};
};
// a frame cut as the enhancer cuts it, and the kept centres of an answer put
// back together
const tilesOf = function(image) {
    const plan = planTiles(image["width"], image["height"]);
    const tiles = plan["tiles"].map(function(tile) {
        const data = new Float32Array(3 * plan["tileWidth"] * plan["tileHeight"]);
        for (let c = 0; c < 3; c++) {
            for (let y = 0; y < plan["tileHeight"]; y++) {
                for (let x = 0; x < plan["tileWidth"]; x++) {
                    data[(c * plan["tileHeight"] + y) * plan["tileWidth"] + x] = readClamped(image, c, tile["ix"] + x, tile["iy"] + y);
                }
            }
        }
        return {"width": plan["tileWidth"], "height": plan["tileHeight"], "data": data};
    });
    return {"plan": plan, "batch": asBatch(tiles)};
};
const stitch = function(plan, output) {
    const scale = output["dims"][3] / plan["tileWidth"];
    const width = plan["width"] * scale;
    const height = plan["height"] * scale;
    const tileWidth = output["dims"][3];
    const tileHeight = output["dims"][2];
    const data = new Float32Array(3 * width * height);
    plan["tiles"].forEach(function(tile, index) {
        for (let c = 0; c < 3; c++) {
            for (let y = 0; y < tile["h"] * scale; y++) {
                const from = ((index * 3 + c) * tileHeight + tile["oy"] * scale + y) * tileWidth + tile["ox"] * scale;
                data.set(output["data"].subarray(from, from + tile["w"] * scale), (c * height + tile["y"] * scale + y) * width + tile["x"] * scale);
            }
        }
    });
    return {"width": width, "height": height, "data": data};
};
const maxDifference = function(a, b) {
    let max = 0;
    for (let i = 0; i < a.length; i++) {
        max = Math.max(max, Math.abs(a[i] - b[i]));
    }
    return max;
};
// PSNR of one picture of a batch against an image, away from the tile's
// edges, where a moved picture has nothing to be moved in from
const psnrInside = function(output, index, image, margin) {
    const width = image["width"];
    const height = image["height"];
    const offset = index * 3 * width * height;
    let sum = 0;
    let count = 0;
    for (let c = 0; c < 3; c++) {
        for (let y = margin; y < height - margin; y++) {
            for (let x = margin; x < width - margin; x++) {
                const i = (c * height + y) * width + x;
                sum += (output["data"][offset + i] - image["data"][i]) ** 2;
                count++;
            }
        }
    }
    return 10 * Math.log10(1 / Math.max(1e-12, sum / count));
};

const TILE_WIDTH = TILE_STEP["width"] + 2 * HALO;
const TILE_HEIGHT = TILE_STEP["height"] + 2 * HALO;

test("every graph runs in the client's runtime and answers a batch of tiles", async () => {
    const batch = asBatch([render(TILE_WIDTH, TILE_HEIGHT, 0, 0), render(TILE_WIDTH, TILE_HEIGHT, 900, 300)]);
    for (const graph of GRAPHS) {
        const pictures = (graph === "upscale" ? [batch] : [batch, batch]);
        const output = await runGraph(graph, pictures);
        const scale = (graph === "upscale" ? 2 : 1);
        assert.deepEqual(output["dims"], [2, 3, TILE_HEIGHT * scale, TILE_WIDTH * scale], graph);
        assert.equal(output["data"].every(Number.isFinite), true, graph + " answers a number for every pixel");
    }
});

// the moment a generated picture shows, in intervals from the previous frame,
// is where schedule() presents it: the real frame is 1, and a step `at` from
// it in the interval is that much later
test("each frame generator shows the moment schedule() presents it at, one motion per tile", async () => {
    const SPEED = 6;
    const MOMENTS = [0, 1 / 3, 1 / 2, 2 / 3, 1, 4 / 3, 3 / 2, 2];
    // two tiles of one batch moving two ways: along x, and along y
    const tileAt = function(moment, index) {
        const shift = Math.round(moment * SPEED);
        return (index === 0 ? render(TILE_WIDTH, TILE_HEIGHT, 100 + shift, 100) : render(TILE_WIDTH, TILE_HEIGHT, 100, 500 + shift));
    };
    const batchAt = function(moment) {
        return asBatch([tileAt(moment, 0), tileAt(moment, 1)]);
    };
    let checked = 0;
    for (const options of [{...OFF, "interpolate": true}, {...OFF, "extrapolate": true}, {...OFF, "interpolate": true, "extrapolate": true}]) {
        const steps = schedule(options, true);
        const frame = steps.find((step) => step["kind"] === "frame");
        for (const step of steps.filter((step) => step["kind"] !== "frame")) {
            const moment = MOMENTS.findIndex((candidate) => Math.abs(candidate - (1 + step["at"] - frame["at"])) < 1e-9);
            assert.notEqual(moment, -1, step["graph"] + " is presented at a moment the test draws");
            const output = await runGraph(step["graph"], [batchAt(0), batchAt(1)]);
            for (const index of [0, 1]) {
                const scores = MOMENTS.map((candidate) => psnrInside(output, index, tileAt(candidate, index), 16));
                const best = scores.indexOf(Math.max(...scores));
                assert.equal(best, moment, step["graph"] + " tile " + index + " shows " + MOMENTS[best] + ", presented as " + MOMENTS[moment]);
                assert.equal(scores[moment] > 40, true, step["graph"] + " tile " + index + " is a picture of its moment, not a blend near it");
            }
            checked++;
        }
    }
    assert.equal(checked, 4, "every frame generator schedule() runs");
});

test("a frame generator gives a picture that does not move back as it is", async () => {
    const still = asBatch([render(TILE_WIDTH, TILE_HEIGHT, 40, 40), render(TILE_WIDTH, TILE_HEIGHT, 700, 90)]);
    for (const graph of GRAPHS.filter((name) => name !== "upscale")) {
        const output = await runGraph(graph, [still, still]);
        assert.equal(maxDifference(output["data"], still["data"]) < 1e-4, true, graph);
    }
});

// tiled and merged is the whole frame run at once with its edges read again
// by the halo, the way the tiles read them: no seam between two tiles, and
// no padding at the frame's edge
test("the upscaler reads no further than the halo", async () => {
    const frame = render(500, 300, 20, 30);
    const {plan, batch} = tilesOf(frame);
    const tiled = stitch(plan, await runGraph("upscale", [batch]));

    const wide = render(500 + 2 * HALO, 300 + 2 * HALO, 0, 0, 0);
    for (let c = 0; c < 3; c++) {
        for (let y = 0; y < wide["height"]; y++) {
            for (let x = 0; x < wide["width"]; x++) {
                wide["data"][(c * wide["height"] + y) * wide["width"] + x] = readClamped(frame, c, x - HALO, y - HALO);
            }
        }
    }
    const whole = await runGraph("upscale", [asBatch([wide])]);
    let max = 0;
    for (let c = 0; c < 3; c++) {
        for (let y = 0; y < tiled["height"]; y++) {
            for (let x = 0; x < tiled["width"]; x++) {
                const inWhole = (c * wide["height"] * 2 + y + 2 * HALO) * wide["width"] * 2 + x + 2 * HALO;
                max = Math.max(max, Math.abs(tiled["data"][(c * tiled["height"] + y) * tiled["width"] + x] - whole["data"][inWhole]));
            }
        }
    }
    assert.equal(max < 1e-5, true, "tiled and whole differ by " + max);
});

// the graph pads with zeros, and the outermost rows of a picture were a
// fifth darker for it before the frame's edge was given a halo of its own
test("the upscaler leaves a flat picture flat out to its edges, and listens to its condition", async () => {
    for (const level of [0.1, 0.5, 0.9]) {
        const {plan, batch} = tilesOf(render(500, 300, 0, 0, level));
        for (const condition of [DEFAULT_CONDITION, [18 / 51, 0, 1], [40 / 51, 1, 0]]) {
            const output = stitch(plan, await runGraph("upscale", [batch], condition));
            const worst = output["data"].reduce((max, value) => Math.max(max, Math.abs(value - level)), 0);
            assert.equal(worst < 1 / 255, true, "level " + level + " told " + condition.join(",") + " is off by " + (worst * 255).toFixed(2) + "/255");
        }
    }
    const picture = asBatch([render(TILE_WIDTH, TILE_HEIGHT, 300, 200)]);
    const low = await runGraph("upscale", [picture], [18 / 51, 0, 1]);
    const high = await runGraph("upscale", [picture], [40 / 51, 1, 0]);
    assert.equal(maxDifference(low["data"], high["data"]) > 1e-3, true, "the condition changes the picture");
});

test("a graph patched for WebGL still loads, and answers what the original does", async () => {
    const batch = asBatch([render(TILE_WIDTH, TILE_HEIGHT, 0, 0), render(TILE_WIDTH, TILE_HEIGHT, 400, 100)]);
    const bytes = new Uint8Array(await fs.readFile(path.join(modelsPath, "upscale.onnx")));
    const patched = await sessionOf("upscale", patchInputDims(bytes, [2, TILE_HEIGHT, TILE_WIDTH]));
    const fixed = await runGraph("upscale", [batch], DEFAULT_CONDITION, patched);
    const dynamic = await runGraph("upscale", [batch]);
    assert.deepEqual(fixed["dims"], dynamic["dims"]);
    assert.equal(maxDifference(fixed["data"], dynamic["data"]) < 1e-6, true);
});
