"use strict";

// the host's own mouse pointer, on its way to the peer. The desktop host keeps
// the cursor *out* of the picture it encodes (see ./stream-ffmpeg.js) and reads
// it with easy-control instead: the shape as a PNG whenever it changes, the
// position while it moves. The peer draws it over the canvas itself, so the
// pointer it is dragging with is drawn by its own machine at its own rate
// rather than arriving a frame late inside the video - see .claude/CLIENT.md,
// "The pointer".
//
// What the addon hands over (Mouse.getIcon()) is the same on every platform:
//     {"width", "height", "data": Uint8Array, "xOffset", "yOffset"}
// `width * height * 4` bytes of RGBA, row by row from the top, straight alpha,
// in physical pixels, with the hotspot in the same pixels - and a width and a
// height of 0 while the pointer is hidden.
//
// What goes on the wire is that picture as a data URL, its size and its
// hotspot as fractions - of the shared display for the size, of the picture
// for the hotspot, because the peer knows the display it is looking at only as
// the rectangle it drew it in - and the shape's own pixel size beside them,
// which is what the hotspot is in when the peer hands the picture to its
// browser as a CSS cursor.
//
// Everything here is pure, and the PNG is written by hand over
// CompressionStream rather than through a canvas, so tests/cursor.test.js can
// run the whole of it under Node.

// whether the icon is a picture there is something to draw of - not a pointer
// the host has hidden, nor a shape the addon could not read and reported empty
const isIconDrawn = function(icon) {
    const data = icon?.["data"];
    const width = icon?.["width"] ?? 0;
    const height = icon?.["height"] ?? 0;
    const isPixels = (Array.isArray(data) === true || ArrayBuffer.isView(data) === true);
    return (isPixels === true && width > 0 && height > 0 && data.length >= width * height * 4);
};

// the fingerprint of a shape, for telling one cursor from the next without
// encoding either: FNV-1a over the pixels as they arrive, with the size and
// the hotspot in front of it. 32 bits is a hash two shapes could collide in,
// and the cost of that is one stale pointer picture out of the handful of
// shapes a session crosses.
const cursorFingerprint = function(icon) {
    if (isIconDrawn(icon) === false) {
        return "";      // nothing to draw: the pointer is hidden
    }
    const data = icon["data"];
    let hash = 0x811c9dc5;
    for (let i = 0, length = icon["width"] * icon["height"] * 4; i < length; i++) {
        hash = Math.imul(hash ^ (data[i] | 0), 0x01000193) >>> 0;
    }
    return icon["width"] + "x" + icon["height"] + "+" + (icon["xOffset"] ?? 0) + "," + (icon["yOffset"] ?? 0)
        + ":" + hash.toString(16);
};

// how many of the icon's own pixels go into one of the display's. The icon is
// in physical pixels on every platform while Screen.list() reports a display
// in logical ones, so the two are the same units only after the display's
// scale is divided out - 1 on X11, which has no logical pixels to report.
const cursorScale = function(screen) {
    const scale = Number(screen?.["scaleFactor"]);
    return (Number.isFinite(scale) === true && scale > 0 ? scale : 1);
};

// the size and the hotspot as the peer is told them: the picture as a fraction
// of the display being shared, the hotspot as a fraction of the picture
const normalizeCursor = function(icon, screen) {
    const scale = cursorScale(screen);
    const screenWidth = (Number(screen?.["width"]) || 1);
    const screenHeight = (Number(screen?.["height"]) || 1);
    const width = (Number(icon?.["width"]) || 1);
    const height = (Number(icon?.["height"]) || 1);
    return {
        "width": width / scale / screenWidth,
        "height": height / scale / screenHeight,
        "hotspotX": (Number(icon?.["xOffset"]) || 0) / width,
        "hotspotY": (Number(icon?.["yOffset"]) || 0) / height
    };
};

//
// the PNG
//
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (function() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = ((c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

const crc32 = function(bytes) {
    let c = 0xffffffff;
    for (let i = 0, length = bytes.length; i < length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
};

// a chunk is its length, its name, its bytes and a CRC over the two last
const pngChunk = function(name, data) {
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) {
        chunk[4 + i] = name.charCodeAt(i);
    }
    chunk.set(data, 8);
    view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    return chunk;
};

// PNG's IDAT is a zlib stream, which is what CompressionStream("deflate")
// makes - the raw one is "deflate-raw" and has no header for the reader to
// check the bytes against
const deflate = async function(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
};

// eight bit RGBA, one image, no interlace, and every row unfiltered: a cursor
// is a few kilobytes of mostly nothing and the filter would buy bytes that the
// deflate behind it has already taken
const encodePNG = async function(width, height, rgba) {
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        const from = y * stride;
        const to = y * (stride + 1) + 1;
        for (let x = 0; x < stride; x++) {
            raw[to + x] = rgba[from + x] & 0xff;
        }
    }
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header[8] = 8;      // bits per channel
    header[9] = 6;      // RGBA
    const body = await deflate(raw);
    const parts = [PNG_SIGNATURE, pngChunk("IHDR", header), pngChunk("IDAT", body), pngChunk("IEND", new Uint8Array(0))];
    let length = 0;
    for (const part of parts) {
        length += part.length;
    }
    const png = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
        png.set(part, at);
        at += part.length;
    }
    return png;
};

// and as a <img> src. In pieces, since the whole of a large cursor is more
// arguments than one apply() takes.
const toDataURL = function(png) {
    let binary = "";
    for (let i = 0, length = png.length; i < length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, png.subarray(i, i + 0x8000));
    }
    return "data:image/png;base64," + btoa(binary);
};

// the whole of what the peer is told about a shape: the picture and where the
// pointer is inside it. Nothing for a cursor the host is not showing at all -
// a game that hid it, a text field that swallowed it - which is the peer
// drawing none either.
const packCursor = async function(icon, screen) {
    if (isIconDrawn(icon) === false) {
        return {"image": null, "width": 0, "height": 0, "hotspotX": 0, "hotspotY": 0,
            "imageWidth": 0, "imageHeight": 0};
    }
    const png = await encodePNG(icon["width"], icon["height"], icon["data"]);
    return {
        "image": toDataURL(png),
        ...normalizeCursor(icon, screen),
        // the shape's own pixels, which is what the hotspot is in when the
        // peer hands the picture to its browser as a CSS cursor
        "imageWidth": icon["width"],
        "imageHeight": icon["height"]
    };
};

export { cursorFingerprint, isIconDrawn, cursorScale, normalizeCursor, encodePNG, toDataURL, packCursor };
export default { cursorFingerprint, isIconDrawn, cursorScale, normalizeCursor, encodePNG, toDataURL, packCursor };
