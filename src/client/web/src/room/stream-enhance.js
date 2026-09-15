"use strict";

// the peer's picture, improved before it is drawn: a decoded frame goes in,
// the models the bar ticked run over it in ONNX Runtime Web, and what comes
// out is handed on as frames the drawer draws like any other. Three
// enhancements - upscale, frame interpolation, frame extrapolation - each a
// graph under /media/models, all three mocks today (model/mock/). Runs in the
// worker beside the decoder and never touches the document. The reasoning is
// .claude/CLIENT.md, "The enhancer".
//
// Two backends, and no third: WebGPU keeps the picture on the GPU from the
// decoder to the canvas, WebGL goes through a pixel array each way, and a
// browser with neither is told so rather than given a CPU that cannot keep up
// with a stream.

// where the runtime and its graphs are served from. The runtime is only
// fetched once an enhancement is turned on: it is 800 KB of script and 26 MB
// of WebAssembly, which a room that draws the picture as it comes never needs.
// Resolved against this module rather than left root-absolute, since the
// runtime opens the WebAssembly through an XMLHttpRequest of its own.
const ORT_URL = new URL("/libs/onnxruntime/ort.all.min.mjs", import.meta.url).href;
const ORT_WASM_PATH = new URL("/libs/onnxruntime/", import.meta.url).href;
const MODELS = {
    "upscale": {"url": new URL("/media/models/upscale.onnx", import.meta.url).href, "frames": 1, "scale": 2},
    "interpolate": {"url": new URL("/media/models/interpolate.onnx", import.meta.url).href, "frames": 2, "scale": 1},
    "extrapolate": {"url": new URL("/media/models/extrapolate.onnx", import.meta.url).href, "frames": 2, "scale": 1}
};
const KINDS = Object.keys(MODELS);
const INPUT_NAME = "input";
const OUTPUT_NAME = "output";

// the frame interval a generated frame is placed inside when the stream has
// not said one yet, and the range a measured one is trusted in
const DEFAULT_INTERVAL = 1000 / 30;
const MIN_INTERVAL = 4;
const MAX_INTERVAL = 200;

// how many frames may wait for the one being enhanced: one - the newest -
// since a picture that is late is worth less than the one after it
const PENDING_MAX = 1;

const OFF = Object.freeze({"upscale": false, "interpolate": false, "extrapolate": false});

// the options as the three booleans they are, whatever was handed in
const normalizeOptions = function(options) {
    const out = {};
    for (const kind of KINDS) {
        out[kind] = (options?.[kind] === true);
    }
    return out;
};

const isAnyOn = function(options) {
    return KINDS.some(function(kind) {
        return options[kind] === true;
    });
};

// what one arriving frame turns into and when, as fractions of the frame
// interval: the interpolated frame stands in *before* the real one and the
// extrapolated one *after* it, so the real frame moves to make room for
// whichever of the two is on. Upscaling is not a step - it is applied to
// every picture the steps produce. Pure, and tested in tests/enhance.test.js.
const schedule = function(options, hasPrevious) {
    const isInterpolate = (options["interpolate"] === true && hasPrevious === true);
    const isExtrapolate = (options["extrapolate"] === true && hasPrevious === true);
    if (isInterpolate === true && isExtrapolate === true) {
        return [
            {"kind": "interpolate", "at": 0},
            {"kind": "frame", "at": 1 / 3},
            {"kind": "extrapolate", "at": 2 / 3}
        ];
    }
    if (isInterpolate === true) {
        return [
            {"kind": "interpolate", "at": 0},
            {"kind": "frame", "at": 1 / 2}
        ];
    }
    if (isExtrapolate === true) {
        return [
            {"kind": "frame", "at": 0},
            {"kind": "extrapolate", "at": 1 / 2}
        ];
    }
    return [{"kind": "frame", "at": 0}];
};

// the models a set of options needs loaded
const modelsFor = function(options) {
    return KINDS.filter(function(kind) {
        return options[kind] === true;
    });
};

// bytes of one float32 NCHW picture, rounded to what the runtime reads in
const bytesOf = function(dims) {
    const count = dims.reduce(function(total, size) {
        return total * size;
    }, 1);
    return Math.ceil(count * 4 / 16) * 16;
};

//
// a graph's input shape, fixed for WebGL
//
// The WebGL provider runs static shapes and nothing else: a dimension the
// graph leaves symbolic (H, W) is read as nothing and refused against a real
// tensor. The graphs are exported dynamic so one file serves every
// resolution, so for WebGL the file is patched instead - the symbolic input
// dimensions written as the frame's, in the protobuf bytes, and a session
// made of the result per resolution. Only the fields on the path to the input
// dims are decoded; everything else is copied as it was.
//
// ModelProto.graph(7) > GraphProto.input(11) > ValueInfoProto.type(2)
//   > TypeProto.tensor_type(1) > Tensor.shape(2) > TensorShapeProto.dim(1)
//   > Dimension.dim_value(1) | dim_param(2)
const readVarint = function(bytes, pos) {
    let value = 0;
    let shift = 0;
    while (pos < bytes.length) {
        const byte = bytes[pos++];
        value += (byte & 0x7F) * Math.pow(2, shift);
        shift += 7;
        if ((byte & 0x80) === 0) {
            return {"value": value, "pos": pos};
        }
    }
    throw new Error("Truncated varint");
};

const writeVarint = function(value) {
    const out = [];
    let left = value;
    do {
        let byte = left % 128;
        left = Math.floor(left / 128);
        if (left > 0) {
            byte |= 0x80;
        }
        out.push(byte);
    } while (left > 0);
    return Uint8Array.from(out);
};

// a message as its fields, each {field, wire, body} with the body the bytes
// after the key (and after the length, for a length-delimited one)
const decodeFields = function(bytes) {
    const fields = [];
    let pos = 0;
    while (pos < bytes.length) {
        const key = readVarint(bytes, pos);
        const field = Math.floor(key["value"] / 8);
        const wire = key["value"] % 8;
        pos = key["pos"];
        let body;
        switch (wire) {
            case 0: {
                const varint = readVarint(bytes, pos);
                body = bytes.subarray(pos, varint["pos"]);
                pos = varint["pos"];
                break;
            }
            case 1:
                body = bytes.subarray(pos, pos + 8);
                pos += 8;
                break;
            case 2: {
                const length = readVarint(bytes, pos);
                body = bytes.subarray(length["pos"], length["pos"] + length["value"]);
                pos = length["pos"] + length["value"];
                break;
            }
            case 5:
                body = bytes.subarray(pos, pos + 4);
                pos += 4;
                break;
            default:
                throw new Error("Unknown protobuf wire type " + wire);
        }
        fields.push({"field": field, "wire": wire, "body": body});
    }
    return fields;
};

const encodeFields = function(fields) {
    const parts = [];
    let total = 0;
    for (const entry of fields) {
        const key = writeVarint(entry["field"] * 8 + entry["wire"]);
        parts.push(key);
        total += key.length;
        if (entry["wire"] === 2) {
            const length = writeVarint(entry["body"].length);
            parts.push(length);
            total += length.length;
        }
        parts.push(entry["body"]);
        total += entry["body"].length;
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const part of parts) {
        out.set(part, pos);
        pos += part.length;
    }
    return out;
};

// every length-delimited field of this number rewritten by fn
const patchField = function(bytes, field, fn) {
    const fields = decodeFields(bytes);
    for (const entry of fields) {
        if (entry["field"] === field && entry["wire"] === 2) {
            entry["body"] = fn(entry["body"]);
        }
    }
    return encodeFields(fields);
};

// the symbolic dimensions of every graph input, in order, set to `sizes`
const patchInputDims = function(modelBytes, sizes) {
    return patchField(modelBytes, 7, function(graph) {
        return patchField(graph, 11, function(input) {
            return patchField(input, 2, function(type) {
                return patchField(type, 1, function(tensorType) {
                    return patchField(tensorType, 2, function(shape) {
                        let index = 0;
                        const fields = decodeFields(shape);
                        for (const entry of fields) {
                            if (entry["field"] !== 1 || entry["wire"] !== 2) {
                                continue;
                            }
                            const isFixed = decodeFields(entry["body"]).some(function(dim) {
                                return dim["field"] === 1;
                            });
                            if (isFixed === false) {
                                const size = sizes[index++];
                                entry["body"] = encodeFields([{"field": 1, "wire": 0, "body": writeVarint(size)}]);
                            }
                        }
                        return encodeFields(fields);
                    });
                });
            });
        });
    });
};

// the dims of every graph input as the graph states them, a symbolic one as
// its name - what the test reads back
const readInputDims = function(modelBytes) {
    const inputs = [];
    for (const graph of decodeFields(modelBytes).filter((entry) => entry["field"] === 7)) {
        for (const input of decodeFields(graph["body"]).filter((entry) => entry["field"] === 11)) {
            const dims = [];
            for (const type of decodeFields(input["body"]).filter((entry) => entry["field"] === 2)) {
                for (const tensorType of decodeFields(type["body"]).filter((entry) => entry["field"] === 1)) {
                    for (const shape of decodeFields(tensorType["body"]).filter((entry) => entry["field"] === 2)) {
                        for (const dim of decodeFields(shape["body"]).filter((entry) => entry["field"] === 1)) {
                            const parts = decodeFields(dim["body"]);
                            const fixed = parts.find((part) => part["field"] === 1);
                            const named = parts.find((part) => part["field"] === 2);
                            dims.push(typeof fixed !== "undefined" ? readVarint(fixed["body"], 0)["value"]
                                : (typeof named !== "undefined" ? new TextDecoder().decode(named["body"]) : null));
                        }
                    }
                }
            }
            inputs.push(dims);
        }
    }
    return inputs;
};

//
// which backend this browser has, asked before the runtime is loaded
//
// A WebGPU adapter that answers is the one to use; a WebGL context that opens
// is the fallback; nothing else is offered. Asked of the worker itself, since
// the decoder and the canvas are here and so is the runtime.
const probeBackend = async function() {
    try {
        if (typeof navigator !== "undefined" && typeof navigator.gpu !== "undefined") {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter !== null) {
                return "webgpu";
            }
        }
    } catch (error) {
        console.warn("WebGPU is not there for the enhancer:", error);
    }
    try {
        if (typeof OffscreenCanvas !== "undefined") {
            const canvas = new OffscreenCanvas(1, 1);
            const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
            if (gl !== null) {
                gl.getExtension("WEBGL_lose_context")?.loseContext();
                return "webgl";
            }
        }
    } catch (error) {
        console.warn("WebGL is not there for the enhancer:", error);
    }
    return "";
};

//
// tiles
//
// A model never sees a whole frame. Every picture is cut into tiles of one
// size and each tile is run on its own, because the runtime's kernels are
// only right up to a size (a whole 1080p frame through the upscaler came back
// as the same 640 pixels repeated, and 270 ms late) and because a session is
// then one shape whatever the stream's resolution, which is what the WebGL
// provider wants anyway. The geometry is the one model/upscale/webexport.py
// measured: a 320x180 step, which divides every 16:9 resolution exactly, and
// the halo every model reads beyond it - shared by the whole chain, so a tile
// out of one model is a tile into the next. A tile near an edge is not cut
// short: its input window is slid back into the frame, so every tile of a
// frame has the same input size and the kept region moves inside it instead.
// A frame smaller than a tile is one tile of its own size.
const TILE_STEP = {"width": 320, "height": 180};
const HALO = 4;

// {width, height, tileWidth, tileHeight, tiles: [{x, y, w, h, ix, iy, ox, oy}]}
// - the kept region (x, y, w, h) in frame pixels, the input window's origin
// (ix, iy), and where the kept region sits inside the window (ox, oy)
const planTiles = function(width, height) {
    const tileWidth = Math.min(width, TILE_STEP["width"] + 2 * HALO);
    const tileHeight = Math.min(height, TILE_STEP["height"] + 2 * HALO);
    const tiles = [];
    for (let y = 0; y < height; y += TILE_STEP["height"]) {
        const h = Math.min(TILE_STEP["height"], height - y);
        const iy = Math.min(Math.max(0, y - HALO), height - tileHeight);
        for (let x = 0; x < width; x += TILE_STEP["width"]) {
            const w = Math.min(TILE_STEP["width"], width - x);
            const ix = Math.min(Math.max(0, x - HALO), width - tileWidth);
            tiles.push({"x": x, "y": y, "w": w, "h": h, "ix": ix, "iy": iy, "ox": x - ix, "oy": y - iy});
        }
    }
    return {"width": width, "height": height, "tileWidth": tileWidth, "tileHeight": tileHeight, "tiles": tiles};
};

// the WGSL uniform both passes read, one per tile, laid out at the uniform
// offset alignment so every tile of a frame is written in one go and each
// bind group points into the same buffer
const INFO_STRIDE = 256;
const INFO_WORDS = 6;

//
// WebGPU: the picture stays on the GPU
//
// A picture here is {plan, scale, dims, tiles: [{buffer, tensor?}]}: every
// tile float32 NCHW in a storage buffer the runtime reads directly
// (Tensor.fromGpuBuffer) and writes directly (preferredOutputLocation
// "gpu-buffer"), `dims` the tile's [1, C, h, w] and `scale` how many output
// pixels a frame pixel has become. A frame becomes one through a compute pass
// per tile over its external texture, and one becomes a frame through a
// render pass that draws each tile's kept region onto a canvas, wrapped as a
// VideoFrame - so the drawer draws it the way it draws a decoded one,
// whichever context it holds. Everything here is on the *runtime's* device:
// this build of the runtime makes its own from the adapter and takes none it
// is handed (env.webgpu.device is written by it, not read), and a buffer is
// only ever a tensor on the device that made it. So the passes are built once
// the first session has been created, which is when that device exists.
const WGSL_TO_PLANES = `
struct Info {
    size: vec2u,        // the tile, in pixels
    origin: vec2u,      // where the tile's window starts in the frame
    frame: vec2u        // the frame, in pixels
};
@group(0) @binding(0) var<uniform> info: Info;
@group(0) @binding(1) var frameSampler: sampler;
@group(0) @binding(2) var frameTexture: texture_external;
@group(0) @binding(3) var<storage, read_write> planes: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= info.size.x || id.y >= info.size.y) {
        return;
    }
    let uv = (vec2f(info.origin + id.xy) + 0.5) / vec2f(info.frame);
    let color = textureSampleBaseClampToEdge(frameTexture, frameSampler, uv);
    let n = info.size.x * info.size.y;
    let i = id.y * info.size.x + id.x;
    planes[i] = color.r;
    planes[n + i] = color.g;
    planes[2u * n + i] = color.b;
}
`;

const WGSL_TO_CANVAS = `
struct Info {
    size: vec2u,        // the tile, in pixels
    origin: vec2u,      // where the kept region starts inside the tile
    frame: vec2u        // where the kept region lands on the canvas
};
@group(0) @binding(0) var<uniform> info: Info;
@group(0) @binding(1) var<storage, read> planes: array<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(pos[index], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
    // the scissor keeps this to the kept region, so the canvas pixel maps
    // back into the tile without a bounds check of its own
    let p = vec2u(position.xy) - info.frame + info.origin;
    let x = min(p.x, info.size.x - 1u);
    let y = min(p.y, info.size.y - 1u);
    let n = info.size.x * info.size.y;
    let i = y * info.size.x + x;
    return vec4f(planes[i], planes[n + i], planes[2u * n + i], 1.0);
}
`;

const createGPUBackend = async function(ort) {
    const device = await ort.env.webgpu.device;
    if (typeof device === "undefined" || device === null) {
        throw new Error("The runtime has no WebGPU device");
    }

    const canvas = new OffscreenCanvas(2, 2);
    const context = canvas.getContext("webgpu");
    if (context === null) {
        throw new Error("No WebGPU context for the enhancer's canvas");
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({"device": device, "format": format, "alphaMode": "opaque"});

    const toPlanes = device.createComputePipeline({
        "layout": "auto",
        "compute": {"module": device.createShaderModule({"code": WGSL_TO_PLANES}), "entryPoint": "main"}
    });
    const toCanvasModule = device.createShaderModule({"code": WGSL_TO_CANVAS});
    const toCanvas = device.createRenderPipeline({
        "layout": "auto",
        "vertex": {"module": toCanvasModule, "entryPoint": "vertexMain"},
        "fragment": {"module": toCanvasModule, "entryPoint": "fragmentMain", "targets": [{"format": format}]},
        "primitive": {"topology": "triangle-list"}
    });
    const sampler = device.createSampler({"magFilter": "linear", "minFilter": "linear"});

    // the per-tile uniforms of a pass, one buffer grown to the tile count
    const createInfos = function() {
        return {"buffer": null, "count": 0, "words": null};
    };
    const infoIn = createInfos();
    const infoOut = createInfos();
    const writeInfos = function(infos, rows) {
        if (infos["count"] < rows.length) {
            infos["buffer"]?.destroy();
            infos["buffer"] = device.createBuffer({
                "size": rows.length * INFO_STRIDE,
                "usage": GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            infos["count"] = rows.length;
            infos["words"] = new Uint32Array(rows.length * INFO_STRIDE / 4);
        }
        for (let index = 0; index < rows.length; index++) {
            infos["words"].set(rows[index], index * INFO_STRIDE / 4);
        }
        device.queue.writeBuffer(infos["buffer"], 0, infos["words"], 0, rows.length * INFO_STRIDE / 4);
    };
    const infoAt = function(infos, index) {
        return {"buffer": infos["buffer"], "offset": index * INFO_STRIDE, "size": INFO_WORDS * 4};
    };

    // storage buffers by size: a frame's worth of tiles is asked for at every
    // frame, and buffers allocated and freed thirty times a second is what a
    // pool is for
    const pool = new Map();
    const acquire = function(dims) {
        const bytes = bytesOf(dims);
        const free = pool.get(bytes);
        if (typeof free !== "undefined" && free.length > 0) {
            return free.pop();
        }
        return device.createBuffer({
            "size": bytes,
            "usage": GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
        });
    };
    const giveBack = function(buffer) {
        const free = pool.get(buffer.size) ?? [];
        free.push(buffer);
        pool.set(buffer.size, free);
    };
    const releaseTile = function(tile) {
        if (typeof tile["tensor"] !== "undefined") {
            tile["tensor"].dispose?.();
            return;
        }
        giveBack(tile["buffer"]);
    };

    return {
        "fromFrame": function(frame) {
            const width = frame.displayWidth || frame.codedWidth;
            const height = frame.displayHeight || frame.codedHeight;
            const plan = planTiles(width, height);
            const dims = [1, 3, plan["tileHeight"], plan["tileWidth"]];
            writeInfos(infoIn, plan["tiles"].map(function(tile) {
                return [plan["tileWidth"], plan["tileHeight"], tile["ix"], tile["iy"], width, height];
            }));
            const texture = device.importExternalTexture({"source": frame});
            const tiles = [];
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(toPlanes);
            for (let index = 0; index < plan["tiles"].length; index++) {
                const buffer = acquire(dims);
                pass.setBindGroup(0, device.createBindGroup({
                    "layout": toPlanes.getBindGroupLayout(0),
                    "entries": [
                        {"binding": 0, "resource": infoAt(infoIn, index)},
                        {"binding": 1, "resource": sampler},
                        {"binding": 2, "resource": texture},
                        {"binding": 3, "resource": {"buffer": buffer}}
                    ]
                }));
                pass.dispatchWorkgroups(Math.ceil(plan["tileWidth"] / 8), Math.ceil(plan["tileHeight"] / 8));
                tiles.push({"buffer": buffer});
            }
            pass.end();
            device.queue.submit([encoder.finish()]);
            return {"plan": plan, "scale": 1, "dims": dims, "tiles": tiles};
        },

        // two pictures as one six channel input, tile by tile: the planes of
        // the first, then of the second, both copies staying on the GPU
        "concat": function(a, b) {
            const planeBytes = a["dims"][2] * a["dims"][3] * 4 * 3;
            const dims = [1, 6, a["dims"][2], a["dims"][3]];
            const tiles = [];
            const encoder = device.createCommandEncoder();
            for (let index = 0; index < a["tiles"].length; index++) {
                const buffer = acquire(dims);
                encoder.copyBufferToBuffer(a["tiles"][index]["buffer"], 0, buffer, 0, planeBytes);
                encoder.copyBufferToBuffer(b["tiles"][index]["buffer"], 0, buffer, planeBytes, planeBytes);
                tiles.push({"buffer": buffer});
            }
            device.queue.submit([encoder.finish()]);
            return {"plan": a["plan"], "scale": a["scale"], "dims": dims, "tiles": tiles};
        },

        // every tile through the session, one at a time - a session runs one
        // thing at a time, and a tile is the one thing
        "run": async function(session, picture, scale) {
            const tiles = [];
            let dims = null;
            try {
                for (const tile of picture["tiles"]) {
                    const input = ort.Tensor.fromGpuBuffer(tile["buffer"], {"dataType": "float32", "dims": picture["dims"]});
                    let output;
                    try {
                        output = (await session.run({[INPUT_NAME]: input}))[OUTPUT_NAME];
                    } finally {
                        input.dispose?.();
                    }
                    dims = [...output.dims];
                    if (output.location !== "gpu-buffer") {
                        // a runtime that answered on the CPU is answered back onto the GPU
                        const buffer = acquire(dims);
                        device.queue.writeBuffer(buffer, 0, output.data);
                        output.dispose?.();
                        tiles.push({"buffer": buffer});
                    } else {
                        tiles.push({"buffer": output.gpuBuffer, "tensor": output});
                    }
                }
            } catch (error) {
                for (const tile of tiles) {
                    releaseTile(tile);
                }
                throw error;
            }
            return {"plan": picture["plan"], "scale": picture["scale"] * scale, "dims": dims, "tiles": tiles};
        },

        "toFrame": function(picture, timestamp) {
            const plan = picture["plan"];
            const scale = picture["scale"];
            const width = plan["width"] * scale;
            const height = plan["height"] * scale;
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            const tileWidth = picture["dims"][3];
            const tileHeight = picture["dims"][2];
            writeInfos(infoOut, plan["tiles"].map(function(tile) {
                return [tileWidth, tileHeight, tile["ox"] * scale, tile["oy"] * scale, tile["x"] * scale, tile["y"] * scale];
            }));
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({
                "colorAttachments": [{
                    "view": context.getCurrentTexture().createView(),
                    "loadOp": "clear",
                    "storeOp": "store",
                    "clearValue": {"r": 0, "g": 0, "b": 0, "a": 1}
                }]
            });
            pass.setPipeline(toCanvas);
            for (let index = 0; index < plan["tiles"].length; index++) {
                const tile = plan["tiles"][index];
                pass.setBindGroup(0, device.createBindGroup({
                    "layout": toCanvas.getBindGroupLayout(0),
                    "entries": [
                        {"binding": 0, "resource": infoAt(infoOut, index)},
                        {"binding": 1, "resource": {"buffer": picture["tiles"][index]["buffer"], "size": bytesOf(picture["dims"])}}
                    ]
                }));
                pass.setScissorRect(tile["x"] * scale, tile["y"] * scale, tile["w"] * scale, tile["h"] * scale);
                pass.draw(3);
            }
            pass.end();
            device.queue.submit([encoder.finish()]);
            return new VideoFrame(canvas, {"timestamp": timestamp});
        },

        "release": function(picture) {
            for (const tile of picture["tiles"]) {
                releaseTile(tile);
            }
        },

        // the frame's work done on the GPU, not only submitted. A run resolves
        // at submit, so without this a frame that costs more GPU time than
        // the interval would queue behind the last one for ever, the CPU
        // clock would say a few ms while the picture fell seconds behind, and
        // nothing would ever be dropped - the queue is bounded here instead.
        "sync": function() {
            return device.queue.onSubmittedWorkDone();
        },

        "close": function() {
            for (const free of pool.values()) {
                for (const buffer of free) {
                    buffer.destroy();
                }
            }
            pool.clear();
            infoIn["buffer"]?.destroy();
            infoOut["buffer"]?.destroy();
            context.unconfigure?.();
            // the device is the runtime's, and goes with it
        }
    };
};

//
// WebGL: the picture goes through a pixel array each way
//
// The WebGL provider takes and returns CPU tensors and nothing else, so a
// frame is read off a 2D canvas and cut into Float32Array tiles, and the
// answer is put back through an ImageData, tile by tile. It is a fallback,
// and the reading says what it costs. The picture is the same shape as the
// GPU one, with `data` in a tile where the other has `buffer`.
const createCPUBackend = function(ort) {
    const inCanvas = new OffscreenCanvas(2, 2);
    const inContext = inCanvas.getContext("2d", {"willReadFrequently": true});
    const outCanvas = new OffscreenCanvas(2, 2);
    const outContext = outCanvas.getContext("2d");
    if (inContext === null || outContext === null) {
        throw new Error("No 2D context for the enhancer's canvases");
    }
    return {
        "fromFrame": function(frame) {
            const width = frame.displayWidth || frame.codedWidth;
            const height = frame.displayHeight || frame.codedHeight;
            if (inCanvas.width !== width || inCanvas.height !== height) {
                inCanvas.width = width;
                inCanvas.height = height;
            }
            inContext.drawImage(frame, 0, 0, width, height);
            const pixels = inContext.getImageData(0, 0, width, height).data;
            const plan = planTiles(width, height);
            const tileWidth = plan["tileWidth"];
            const tileHeight = plan["tileHeight"];
            const n = tileWidth * tileHeight;
            const tiles = plan["tiles"].map(function(tile) {
                const data = new Float32Array(3 * n);
                for (let y = 0; y < tileHeight; y++) {
                    for (let x = 0; x < tileWidth; x++) {
                        const source = ((tile["iy"] + y) * width + tile["ix"] + x) * 4;
                        const i = y * tileWidth + x;
                        data[i] = pixels[source] / 255;
                        data[n + i] = pixels[source + 1] / 255;
                        data[2 * n + i] = pixels[source + 2] / 255;
                    }
                }
                return {"data": data};
            });
            return {"plan": plan, "scale": 1, "dims": [1, 3, tileHeight, tileWidth], "tiles": tiles};
        },

        "concat": function(a, b) {
            const tiles = a["tiles"].map(function(tile, index) {
                const data = new Float32Array(tile["data"].length + b["tiles"][index]["data"].length);
                data.set(tile["data"], 0);
                data.set(b["tiles"][index]["data"], tile["data"].length);
                return {"data": data};
            });
            return {"plan": a["plan"], "scale": a["scale"], "dims": [1, 6, a["dims"][2], a["dims"][3]], "tiles": tiles};
        },

        "run": async function(session, picture, scale) {
            const tiles = [];
            let dims = null;
            for (const tile of picture["tiles"]) {
                const input = new ort.Tensor("float32", tile["data"], picture["dims"]);
                const output = (await session.run({[INPUT_NAME]: input}))[OUTPUT_NAME];
                dims = [...output.dims];
                tiles.push({"data": (output.data instanceof Float32Array ? output.data : Float32Array.from(output.data))});
            }
            return {"plan": picture["plan"], "scale": picture["scale"] * scale, "dims": dims, "tiles": tiles};
        },

        "toFrame": function(picture, timestamp) {
            const plan = picture["plan"];
            const scale = picture["scale"];
            const width = plan["width"] * scale;
            const height = plan["height"] * scale;
            const tileWidth = picture["dims"][3];
            const tileHeight = picture["dims"][2];
            const n = tileWidth * tileHeight;
            const pixels = new Uint8ClampedArray(width * height * 4);
            plan["tiles"].forEach(function(tile, index) {
                const data = picture["tiles"][index]["data"];
                for (let y = 0; y < tile["h"] * scale; y++) {
                    for (let x = 0; x < tile["w"] * scale; x++) {
                        const i = (tile["oy"] * scale + y) * tileWidth + tile["ox"] * scale + x;
                        const target = ((tile["y"] * scale + y) * width + tile["x"] * scale + x) * 4;
                        pixels[target] = data[i] * 255;
                        pixels[target + 1] = data[n + i] * 255;
                        pixels[target + 2] = data[2 * n + i] * 255;
                        pixels[target + 3] = 255;
                    }
                }
            });
            if (outCanvas.width !== width || outCanvas.height !== height) {
                outCanvas.width = width;
                outCanvas.height = height;
            }
            outContext.putImageData(new ImageData(pixels, width, height), 0, 0);
            return new VideoFrame(outCanvas, {"timestamp": timestamp});
        },

        "release": function() {},
        "sync": function() {},
        "close": function() {}
    };
};

//
// the enhancer
//
// {backend, onPresent, onError}: the backend probeBackend() answered, a frame
// to draw, and a failure that turned an option off.
const createEnhancer = async function({backend, onPresent, onError}) {
    const ort = await import(ORT_URL);
    ort.env.wasm.wasmPaths = ORT_WASM_PATH;
    ort.env.wasm.numThreads = 1;    // no cross-origin isolation, so no threads to have
    ort.env.logLevel = "warning";

    const sessions = new Map();     // kind (and, for WebGL, the size) -> InferenceSession
    const graphs = new Map();       // kind -> the model bytes, for the WebGL patching
    let engine = null;              // made after the first session, on the runtime's device

    let options = {...OFF};
    let previous = null;            // the last picture, for the two-frame models
    let previousTimestamp = -1;
    let interval = DEFAULT_INTERVAL;
    let isBusy = false;
    let pending = [];               // frames that arrived while busy, newest last
    let scheduled = [];             // {frame, timerId} not yet drawn
    let isClosed = false;
    let generation = 0;             // bumped by reset(), so a frame in flight across it is let go

    // counted between two stats readings
    let runCount = 0;
    let runMs = 0;
    let droppedCount = 0;

    const sessionOptions = {
        "executionProviders": [backend],
        "graphOptimizationLevel": "all",
        ...(backend === "webgpu" ? {"preferredOutputLocation": "gpu-buffer"} : {})
    };

    // the graph's bytes, fetched once per kind
    const loadGraph = async function(kind) {
        if (graphs.has(kind) === false) {
            const response = await fetch(MODELS[kind]["url"]);
            if (response.ok === false) {
                throw new Error("Cannot fetch the " + kind + " model (" + response.status + ")");
            }
            graphs.set(kind, new Uint8Array(await response.arrayBuffer()));
        }
        return graphs.get(kind);
    };

    // a session for a kind - and, on WebGL, for the size of the tile it is
    // about to run on, since that provider takes one shape per session. One
    // size at a time per kind: only a frame smaller than a tile changes it.
    const loadSession = async function(kind, dims) {
        const isStatic = (backend === "webgl");
        const key = (isStatic === true ? kind + "|" + dims[2] + "x" + dims[3] : kind);
        if (sessions.has(key) === true) {
            return sessions.get(key);
        }
        let bytes = await loadGraph(kind);
        if (isStatic === true) {
            for (const [held, session] of [...sessions]) {
                if (held.startsWith(kind + "|") === true) {
                    sessions.delete(held);
                    await session.release?.();
                }
            }
            bytes = patchInputDims(bytes, [dims[2], dims[3]]);
        }
        const session = await ort.InferenceSession.create(bytes, sessionOptions);
        sessions.set(key, session);
        await ensureEngine();
        return session;
    };

    // the engine the pictures go through: on WebGPU it wants the runtime's
    // device, which exists once a session does; on WebGL it wants nothing
    const ensureEngine = async function() {
        if (engine === null) {
            engine = (backend === "webgpu" ? await createGPUBackend(ort) : createCPUBackend(ort));
        }
        return engine;
    };

    // a frame drawn now, or held for its place in the interval. Whatever is
    // still held when the next real frame arrives goes out ahead of it, in
    // order, so a generated frame never covers a real one and none is lost.
    const flushScheduled = function() {
        for (const entry of scheduled) {
            clearTimeout(entry["timerId"]);
            onPresent(entry["frame"]);
        }
        scheduled = [];
    };
    const present = function(frame, delay) {
        if (isClosed === true) {
            frame.close();
            return;
        }
        if (delay <= 0) {
            onPresent(frame);
            return;
        }
        const entry = {"frame": frame, "timerId": -1};
        entry["timerId"] = setTimeout(function() {
            scheduled = scheduled.filter(function(held) {
                return held !== entry;
            });
            onPresent(frame);
        }, delay);
        scheduled.push(entry);
    };

    const dropPrevious = function() {
        if (previous !== null) {
            engine.release(previous);
            previous = null;
        }
        previousTimestamp = -1;
    };

    // one frame through the steps its options ask for
    const process = async function(frame) {
        const started = performance.now();
        const timestamp = frame.timestamp;
        await ensureEngine();
        const current = engine.fromFrame(frame);
        frame.close();
        const startGeneration = generation;

        // the interval from the stream's own clock, in ms
        if (previousTimestamp >= 0 && timestamp > previousTimestamp) {
            interval = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, (timestamp - previousTimestamp) / 1000));
        }
        flushScheduled();

        const steps = schedule(options, previous !== null);
        for (const step of steps) {
            let picture = current;
            if (step["kind"] !== "frame") {
                const input = engine.concat(previous, current);
                try {
                    picture = await engine.run(await loadSession(step["kind"], input["dims"]), input, MODELS[step["kind"]]["scale"]);
                } finally {
                    engine.release(input);
                }
            }
            if (options["upscale"] === true) {
                const source = picture;
                try {
                    picture = await engine.run(await loadSession("upscale", source["dims"]), source, MODELS["upscale"]["scale"]);
                } finally {
                    if (source !== current) {
                        engine.release(source);
                    }
                }
            }
            if (generation !== startGeneration) {
                // reset while running: the stream this picture was of is gone
                if (picture !== current) {
                    engine.release(picture);
                }
                engine.release(current);
                return;
            }
            const delay = step["at"] * interval;
            const out = engine.toFrame(picture, Math.round(timestamp + delay * 1000));
            if (picture !== current) {
                engine.release(picture);
            }
            present(out, delay);
        }
        await engine.sync();

        dropPrevious();
        previous = current;
        previousTimestamp = timestamp;
        runCount++;
        runMs += performance.now() - started;
    };

    // frames are taken one at a time, and one that arrived meanwhile waits -
    // only the newest, since an enhancer that is behind should not fall
    // further behind by working through what it missed
    const drain = async function() {
        if (isBusy === true) {
            return;
        }
        isBusy = true;
        try {
            while (pending.length > 0 && isClosed === false) {
                const frame = pending.shift();
                if (isAnyOn(options) === false) {
                    onPresent(frame);
                    continue;
                }
                try {
                    await process(frame);
                } catch (error) {
                    console.error("The enhancer failed:", error);
                    options = {...OFF};
                    dropPrevious();
                    onError(String(error?.message ?? error));
                }
            }
        } finally {
            isBusy = false;
        }
    };

    return {
        "getBackend": function() {
            return backend;
        },

        // what is on. The models it needs are loaded here, so a graph that
        // will not load refuses the option rather than the next frame - on
        // WebGL only fetched, since a session there waits for a size.
        "setOptions": async function(wanted) {
            const next = normalizeOptions(wanted);
            for (const kind of modelsFor(next)) {
                if (backend === "webgl") {
                    await loadGraph(kind);
                } else {
                    await loadSession(kind, null);
                }
            }
            const wasTwoFrame = (options["interpolate"] === true || options["extrapolate"] === true);
            const isTwoFrame = (next["interpolate"] === true || next["extrapolate"] === true);
            options = next;
            if (wasTwoFrame === true && isTwoFrame === false) {
                dropPrevious();
            }
            return {...options};
        },
        "getOptions": function() {
            return {...options};
        },
        "isActive": function() {
            return isAnyOn(options);
        },

        // a decoded frame, which is the enhancer's from here: drawn as it is
        // while nothing is on, enhanced otherwise
        "push": function(frame) {
            if (isClosed === true) {
                frame.close();
                return;
            }
            if (isAnyOn(options) === false && isBusy === false) {
                onPresent(frame);
                return;
            }
            while (pending.length >= PENDING_MAX) {
                pending.shift().close();
                droppedCount++;
            }
            pending.push(frame);
            drain();
        },

        // the stream is over or restarted: nothing of the last picture carries
        // into the next one
        "reset": function() {
            for (const frame of pending) {
                frame.close();
            }
            pending = [];
            for (const entry of scheduled) {
                clearTimeout(entry["timerId"]);
                entry["frame"].close();
            }
            scheduled = [];
            dropPrevious();
            generation++;
        },

        // the reading since the last one: what a frame costs from arrival to
        // its last picture done on the GPU, and how many were not worth
        // waiting for
        "getStats": function() {
            const stats = {
                "backend": backend,
                "ms": (runCount > 0 ? Math.round(runMs / runCount * 10) / 10 : 0),
                "runs": runCount,
                "dropped": droppedCount
            };
            runCount = 0;
            runMs = 0;
            droppedCount = 0;
            return stats;
        },

        "close": async function() {
            isClosed = true;
            this.reset();
            for (const session of sessions.values()) {
                try {
                    await session.release?.();
                } catch (error) {
                    // a session that will not release is one the worker is leaving anyway
                }
            }
            sessions.clear();
            engine?.close();
            engine = null;
        }
    };
};

export { KINDS, OFF, TILE_STEP, HALO, schedule, planTiles, normalizeOptions, isAnyOn, modelsFor, bytesOf, patchInputDims, readInputDims, probeBackend, createEnhancer };
export default { KINDS, OFF, TILE_STEP, HALO, schedule, planTiles, normalizeOptions, isAnyOn, modelsFor, bytesOf, patchInputDims, readInputDims, probeBackend, createEnhancer };
