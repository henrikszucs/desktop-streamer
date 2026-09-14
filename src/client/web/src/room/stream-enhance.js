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
    "upscale": {"url": new URL("/media/models/upscale.onnx", import.meta.url).href, "frames": 1},
    "interpolate": {"url": new URL("/media/models/interpolate.onnx", import.meta.url).href, "frames": 2},
    "extrapolate": {"url": new URL("/media/models/extrapolate.onnx", import.meta.url).href, "frames": 2}
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
// WebGPU: the picture stays on the GPU
//
// A picture here is {dims, buffer, tensor?}: float32 NCHW in a storage buffer
// the runtime reads directly (Tensor.fromGpuBuffer) and writes directly
// (preferredOutputLocation "gpu-buffer"). A frame becomes one through a
// compute pass over its external texture, and one becomes a frame through a
// render pass onto a canvas, wrapped as a VideoFrame - so the drawer draws it
// the way it draws a decoded one, whichever context it holds. Everything here
// is on the *runtime's* device: this build of the runtime makes its own from
// the adapter and takes none it is handed (env.webgpu.device is written by it,
// not read), and a buffer is only ever a tensor on the device that made it.
// So the passes are built once the first session has been created, which is
// when that device exists.
const WGSL_TO_PLANES = `
struct Info {
    width: u32,
    height: u32
};
@group(0) @binding(0) var<uniform> info: Info;
@group(0) @binding(1) var frameSampler: sampler;
@group(0) @binding(2) var frameTexture: texture_external;
@group(0) @binding(3) var<storage, read_write> planes: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= info.width || id.y >= info.height) {
        return;
    }
    let uv = (vec2f(f32(id.x), f32(id.y)) + 0.5) / vec2f(f32(info.width), f32(info.height));
    let color = textureSampleBaseClampToEdge(frameTexture, frameSampler, uv);
    let n = info.width * info.height;
    let i = id.y * info.width + id.x;
    planes[i] = color.r;
    planes[n + i] = color.g;
    planes[2u * n + i] = color.b;
}
`;

const WGSL_TO_CANVAS = `
struct Info {
    width: u32,
    height: u32
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
    let x = min(u32(position.x), info.width - 1u);
    let y = min(u32(position.y), info.height - 1u);
    let n = info.width * info.height;
    let i = y * info.width + x;
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
    const infoIn = device.createBuffer({"size": 16, "usage": GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const infoOut = device.createBuffer({"size": 16, "usage": GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});

    // storage buffers by size: a frame's worth is asked for at every frame, and
    // 25 MB allocated and freed thirty times a second is what a pool is for
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
    const writeInfo = function(buffer, width, height) {
        device.queue.writeBuffer(buffer, 0, new Uint32Array([width, height, 0, 0]));
    };

    return {
        "fromFrame": function(frame) {
            const width = frame.displayWidth || frame.codedWidth;
            const height = frame.displayHeight || frame.codedHeight;
            const dims = [1, 3, height, width];
            const buffer = acquire(dims);
            writeInfo(infoIn, width, height);
            const bindGroup = device.createBindGroup({
                "layout": toPlanes.getBindGroupLayout(0),
                "entries": [
                    {"binding": 0, "resource": {"buffer": infoIn}},
                    {"binding": 1, "resource": sampler},
                    {"binding": 2, "resource": device.importExternalTexture({"source": frame})},
                    {"binding": 3, "resource": {"buffer": buffer}}
                ]
            });
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(toPlanes);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
            pass.end();
            device.queue.submit([encoder.finish()]);
            return {"dims": dims, "buffer": buffer};
        },

        // two pictures as one six channel input: the planes of the first, then
        // of the second, both copies staying on the GPU
        "concat": function(a, b) {
            const planeBytes = a["dims"][2] * a["dims"][3] * 4 * 3;
            const dims = [1, 6, a["dims"][2], a["dims"][3]];
            const buffer = acquire(dims);
            const encoder = device.createCommandEncoder();
            encoder.copyBufferToBuffer(a["buffer"], 0, buffer, 0, planeBytes);
            encoder.copyBufferToBuffer(b["buffer"], 0, buffer, planeBytes, planeBytes);
            device.queue.submit([encoder.finish()]);
            return {"dims": dims, "buffer": buffer};
        },

        "run": async function(session, picture) {
            const input = ort.Tensor.fromGpuBuffer(picture["buffer"], {"dataType": "float32", "dims": picture["dims"]});
            try {
                const results = await session.run({[INPUT_NAME]: input});
                const output = results[OUTPUT_NAME];
                if (output.location !== "gpu-buffer") {
                    // a runtime that answered on the CPU is answered back onto the GPU
                    const dims = [...output.dims];
                    const buffer = acquire(dims);
                    device.queue.writeBuffer(buffer, 0, output.data);
                    output.dispose?.();
                    return {"dims": dims, "buffer": buffer};
                }
                return {"dims": [...output.dims], "buffer": output.gpuBuffer, "tensor": output};
            } finally {
                input.dispose?.();
            }
        },

        "toFrame": function(picture, timestamp) {
            const width = picture["dims"][3];
            const height = picture["dims"][2];
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            writeInfo(infoOut, width, height);
            const bindGroup = device.createBindGroup({
                "layout": toCanvas.getBindGroupLayout(0),
                "entries": [
                    {"binding": 0, "resource": {"buffer": infoOut}},
                    {"binding": 1, "resource": {"buffer": picture["buffer"], "size": bytesOf(picture["dims"])}}
                ]
            });
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
            pass.setBindGroup(0, bindGroup);
            pass.draw(3);
            pass.end();
            device.queue.submit([encoder.finish()]);
            return new VideoFrame(canvas, {"timestamp": timestamp});
        },

        "release": function(picture) {
            if (typeof picture["tensor"] !== "undefined") {
                picture["tensor"].dispose?.();
                return;
            }
            giveBack(picture["buffer"]);
        },

        "close": function() {
            for (const free of pool.values()) {
                for (const buffer of free) {
                    buffer.destroy();
                }
            }
            pool.clear();
            infoIn.destroy();
            infoOut.destroy();
            context.unconfigure?.();
            // the device is the runtime's, and goes with it
        }
    };
};

//
// WebGL: the picture goes through a pixel array each way
//
// The WebGL provider takes and returns CPU tensors and nothing else, so a
// frame is read off a 2D canvas into a Float32Array, and the answer is put
// back through an ImageData. It is a fallback, and the reading says what it
// costs.
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
            const n = width * height;
            const data = new Float32Array(3 * n);
            for (let i = 0; i < n; i++) {
                data[i] = pixels[i * 4] / 255;
                data[n + i] = pixels[i * 4 + 1] / 255;
                data[2 * n + i] = pixels[i * 4 + 2] / 255;
            }
            return {"dims": [1, 3, height, width], "data": data};
        },

        "concat": function(a, b) {
            const data = new Float32Array(a["data"].length + b["data"].length);
            data.set(a["data"], 0);
            data.set(b["data"], a["data"].length);
            return {"dims": [1, 6, a["dims"][2], a["dims"][3]], "data": data};
        },

        "run": async function(session, picture) {
            const input = new ort.Tensor("float32", picture["data"], picture["dims"]);
            const results = await session.run({[INPUT_NAME]: input});
            const output = results[OUTPUT_NAME];
            const data = (output.data instanceof Float32Array ? output.data : Float32Array.from(output.data));
            return {"dims": [...output.dims], "data": data};
        },

        "toFrame": function(picture, timestamp) {
            const width = picture["dims"][3];
            const height = picture["dims"][2];
            const n = width * height;
            const data = picture["data"];
            const pixels = new Uint8ClampedArray(n * 4);
            for (let i = 0; i < n; i++) {
                pixels[i * 4] = data[i] * 255;
                pixels[i * 4 + 1] = data[n + i] * 255;
                pixels[i * 4 + 2] = data[2 * n + i] * 255;
                pixels[i * 4 + 3] = 255;
            }
            if (outCanvas.width !== width || outCanvas.height !== height) {
                outCanvas.width = width;
                outCanvas.height = height;
            }
            outContext.putImageData(new ImageData(pixels, width, height), 0, 0);
            return new VideoFrame(outCanvas, {"timestamp": timestamp});
        },

        "release": function() {},
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

    // a session for a kind - and, on WebGL, for the size of the picture it is
    // about to run on, since that provider takes one shape per session. One
    // size at a time per kind: a stream that changes resolution replaces it.
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
                    picture = await engine.run(await loadSession(step["kind"], input["dims"]), input);
                } finally {
                    engine.release(input);
                }
            }
            if (options["upscale"] === true) {
                const source = picture;
                try {
                    picture = await engine.run(await loadSession("upscale", source["dims"]), source);
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
        // its last presented picture, and how many were not worth waiting for
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

export { KINDS, OFF, schedule, normalizeOptions, isAnyOn, modelsFor, bytesOf, patchInputDims, readInputDims, probeBackend, createEnhancer };
export default { KINDS, OFF, schedule, normalizeOptions, isAnyOn, modelsFor, bytesOf, patchInputDims, readInputDims, probeBackend, createEnhancer };
