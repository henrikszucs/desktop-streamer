"use strict";

// how a decoded frame gets onto the canvas: three ways, tried in order, all of
// them the frame staying on the GPU. WebGPU is the one the upscaling work will
// hang off (a VideoFrame imported as an external texture is what a model would
// read), WebGL is the same thing for a browser without it, and the 2D context
// is the last resort - still a GPU copy in every browser that has WebCodecs.
// Each one is {draw(frame), close()}, and draw() sizes the canvas to the frame.
// Runs in the worker (./stream-worker.js) and never touches the document.

const fit = function(canvas, frame) {
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;
    const isResized = (canvas.width !== width || canvas.height !== height);
    if (isResized === true) {
        canvas.width = width;
        canvas.height = height;
    }
    return isResized;
};

//
// WebGPU
//
const WGSL = `
struct Out {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f
};

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> Out {
    // one triangle over the whole clip space, its uv clipped to the canvas
    var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    var out: Out;
    out.position = vec4f(pos[index], 0.0, 1.0);
    out.uv = vec2f((pos[index].x + 1.0) * 0.5, 1.0 - (pos[index].y + 1.0) * 0.5);
    return out;
}

@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_external;

@fragment
fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    return textureSampleBaseClampToEdge(frameTexture, frameSampler, uv);
}
`;

const createWebGPUDrawer = async function(canvas) {
    if (typeof navigator === "undefined" || typeof navigator.gpu === "undefined") {
        return undefined;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) {
        return undefined;
    }
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (context === null) {
        return undefined;
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({"device": device, "format": format, "alphaMode": "opaque"});

    const module = device.createShaderModule({"code": WGSL});
    const pipeline = device.createRenderPipeline({
        "layout": "auto",
        "vertex": {"module": module, "entryPoint": "vertexMain"},
        "fragment": {"module": module, "entryPoint": "fragmentMain", "targets": [{"format": format}]},
        "primitive": {"topology": "triangle-list"}
    });
    const sampler = device.createSampler({"magFilter": "linear", "minFilter": "linear"});

    return {
        "name": "webgpu",
        "draw": function(frame) {
            fit(canvas, frame);
            const texture = device.importExternalTexture({"source": frame});
            const bindGroup = device.createBindGroup({
                "layout": pipeline.getBindGroupLayout(0),
                "entries": [
                    {"binding": 0, "resource": sampler},
                    {"binding": 1, "resource": texture}
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
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.draw(3);
            pass.end();
            device.queue.submit([encoder.finish()]);
        },
        "close": function() {
            context.unconfigure?.();
            device.destroy?.();
        }
    };
};

//
// WebGL
//
const GLSL_VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
    uv = vec2((position.x + 1.0) * 0.5, 1.0 - (position.y + 1.0) * 0.5);
    gl_Position = vec4(position, 0.0, 1.0);
}
`;
const GLSL_FRAGMENT = `
precision mediump float;
uniform sampler2D frameTexture;
varying vec2 uv;
void main() {
    gl_FragColor = texture2D(frameTexture, uv);
}
`;

const createWebGLDrawer = function(canvas) {
    const gl = canvas.getContext("webgl2", {"alpha": false, "antialias": false, "desynchronized": true})
        ?? canvas.getContext("webgl", {"alpha": false, "antialias": false, "desynchronized": true});
    if (gl === null) {
        return undefined;
    }
    const compile = function(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === false) {
            throw new Error(gl.getShaderInfoLog(shader));
        }
        return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, GLSL_VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, GLSL_FRAGMENT));
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) === false) {
        throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(program, "frameTexture"), 0);

    return {
        "name": "webgl",
        "draw": function(frame) {
            if (fit(canvas, frame) === true) {
                gl.viewport(0, 0, canvas.width, canvas.height);
            }
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        },
        "close": function() {
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        }
    };
};

//
// 2D
//
const create2DDrawer = function(canvas) {
    const context = canvas.getContext("2d", {"alpha": false, "desynchronized": true});
    if (context === null) {
        return undefined;
    }
    return {
        "name": "2d",
        "draw": function(frame) {
            fit(canvas, frame);
            context.drawImage(frame, 0, 0, canvas.width, canvas.height);
        },
        "close": function() {}
    };
};

// the first of the three that works on this canvas. A context that was opened
// and failed is not reopened as another kind - a canvas is one kind for life -
// so each attempt is made on the canvas only when the one before it never got
// as far as opening a context.
const createDrawer = async function(canvas) {
    try {
        const drawer = await createWebGPUDrawer(canvas);
        if (typeof drawer !== "undefined") {
            return drawer;
        }
    } catch (error) {
        console.warn("WebGPU is not drawing the stream:", error);
    }
    try {
        const drawer = createWebGLDrawer(canvas);
        if (typeof drawer !== "undefined") {
            return drawer;
        }
    } catch (error) {
        console.warn("WebGL is not drawing the stream:", error);
    }
    return create2DDrawer(canvas);
};

export { createDrawer, createWebGPUDrawer, createWebGLDrawer, create2DDrawer };
export default { createDrawer, createWebGPUDrawer, createWebGLDrawer, create2DDrawer };
