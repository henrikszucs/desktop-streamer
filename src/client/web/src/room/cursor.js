"use strict";

// the host's own mouse pointer, on its way to the peer. The desktop host keeps
// the cursor *out* of the picture it encodes (see ./stream-ffmpeg.js) and reads
// it with easy-control instead: the shape as a PNG whenever it changes, the
// position while it moves. The peer draws it over the canvas itself, so the
// pointer it is dragging with is drawn by its own machine at its own rate
// rather than arriving a frame late inside the video - see .claude/CLIENT.md,
// "The pointer".
//
// What the addon hands over (Mouse.getIcon()) is
//     {"width", "height", "data": [...], "xOffset", "yOffset"}
// and `data` is one of two pictures, depending on the build of easy-control
// behind it. `width * height * 4` entries are RGBA, a byte per channel, the
// way `dev/control/src/mouse.cpp` writes them today. `width * height` entries
// are one packed pixel each, `0xAARRGGBB`, which is what the addon vendored
// under `src/client/native/` reports - it predates that source and fills no
// alpha at all, so its picture is a silhouette: the pointer's own shape in one
// colour and nothing around it. Both are read here, because the client is not
// what builds the addon and either may be the one it is running against.
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

// how many entries of `data` make one pixel of the icon, or 0 for an icon
// there is nothing to draw of - a pointer the host has hidden, or a shape the
// addon could not read and reported empty
const iconStride = function(icon) {
    const data = icon?.["data"];
    const width = icon?.["width"] ?? 0;
    const height = icon?.["height"] ?? 0;
    const isPixels = (Array.isArray(data) === true || ArrayBuffer.isView(data) === true);
    if (isPixels === false || width <= 0 || height <= 0) {
        return 0;
    }
    if (data.length >= width * height * 4) {
        return 4;       // RGBA, a byte per channel
    }
    if (data.length >= width * height) {
        return 1;       // one packed pixel each
    }
    return 0;           // fewer pixels than it claims to be: not a picture
};

// the fingerprint of a shape, for telling one cursor from the next without
// encoding either: FNV-1a over the pixels as they arrive, with the size, the
// hotspot and the layout in front of it. 32 bits is a hash two shapes could
// collide in, and the cost of that is one stale pointer picture out of the
// handful of shapes a session crosses.
const cursorFingerprint = function(icon) {
    const stride = iconStride(icon);
    if (stride === 0) {
        return "";      // nothing to draw: the pointer is hidden
    }
    const data = icon["data"];
    let hash = 0x811c9dc5;
    for (let i = 0, length = icon["width"] * icon["height"] * stride; i < length; i++) {
        hash = Math.imul(hash ^ (data[i] | 0), 0x01000193) >>> 0;
    }
    return icon["width"] + "x" + icon["height"] + "+" + (icon["xOffset"] ?? 0) + "," + (icon["yOffset"] ?? 0)
        + "/" + stride + ":" + hash.toString(16);
};

// the outline a silhouette is given before it is sent. An addon that reports
// no alpha reports no border either - the Windows arrow arrives as one white
// shape where it is really white inside a black edge - and a white pointer on
// a white document is a pointer nobody can see. So every empty pixel touching
// the shape becomes its contrast: black around a light pointer, white around a
// dark one. Nothing is invented about the shape itself, only about the edge it
// lost, and a picture that came with an alpha channel never goes through here.
const outlineSilhouette = function(rgba, width, height) {
    let light = 0;
    let solid = 0;
    for (let i = 0; i < width * height; i++) {
        if (rgba[i * 4 + 3] === 0) {
            continue;
        }
        solid++;
        light += (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
    }
    if (solid === 0) {
        return rgba;
    }
    const edge = (light / solid > 127 ? 0 : 255);
    const drawn = rgba.slice();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            if (rgba[at + 3] !== 0) {
                continue;
            }
            const isEdge = ((x > 0 && rgba[at - 4 + 3] !== 0)
                || (x < width - 1 && rgba[at + 4 + 3] !== 0)
                || (y > 0 && rgba[at - width * 4 + 3] !== 0)
                || (y < height - 1 && rgba[at + width * 4 + 3] !== 0));
            if (isEdge === false) {
                continue;
            }
            drawn[at] = edge;
            drawn[at + 1] = edge;
            drawn[at + 2] = edge;
            drawn[at + 3] = 255;
        }
    }
    return drawn;
};

// the icon's pixels as RGBA, whichever of the two ways the addon reported them
const readIcon = function(icon) {
    const stride = iconStride(icon);
    if (stride === 0) {
        return null;
    }
    const width = icon["width"];
    const height = icon["height"];
    const data = icon["data"];
    const count = width * height;
    const rgba = new Uint8Array(count * 4);
    if (stride === 4) {
        for (let i = 0; i < count * 4; i++) {
            rgba[i] = data[i] & 0xff;
        }
        return rgba;
    }

    // packed, so the alpha byte is the question: a build that fills it is read
    // as it is, and one that leaves it empty the whole way through is a
    // silhouette, where anything that is not blank is the pointer
    let isAlpha = false;
    for (let i = 0; i < count; i++) {
        if (((data[i] >>> 24) & 0xff) !== 0) {
            isAlpha = true;
            break;
        }
    }
    for (let i = 0; i < count; i++) {
        const pixel = data[i] >>> 0;
        rgba[i * 4] = (pixel >>> 16) & 0xff;
        rgba[i * 4 + 1] = (pixel >>> 8) & 0xff;
        rgba[i * 4 + 2] = pixel & 0xff;
        rgba[i * 4 + 3] = (isAlpha === true
            ? (pixel >>> 24) & 0xff
            : ((pixel & 0xffffff) !== 0 ? 255 : 0));
    }
    return (isAlpha === true ? rgba : outlineSilhouette(rgba, width, height));
};

// how many of the icon's own pixels go into one of the display's. Windows
// hands the cursor over at the size it is drawn on screen, which follows the
// display's scaling, while Screen.list() reports that display in logical
// pixels - so the two are the same units only after the scale is divided out.
// The other platforms report both in the same units already: a macOS NSImage
// is in points, and the X11 scale is read off the monitor's millimetres rather
// than off any scaling the desktop applies.
const cursorScale = function(platform, screen) {
    if (platform !== "win32") {
        return 1;
    }
    const scale = Number(screen?.["scaleFactor"]);
    return (Number.isFinite(scale) === true && scale > 0 ? scale : 1);
};

// the size and the hotspot as the peer is told them: the picture as a fraction
// of the display being shared, the hotspot as a fraction of the picture
const normalizeCursor = function(icon, screen, platform) {
    const scale = cursorScale(platform, screen);
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
const packCursor = async function(icon, screen, platform) {
    const rgba = readIcon(icon);
    if (rgba === null) {
        return {"image": null, "width": 0, "height": 0, "hotspotX": 0, "hotspotY": 0,
            "imageWidth": 0, "imageHeight": 0};
    }
    const png = await encodePNG(icon["width"], icon["height"], rgba);
    return {
        "image": toDataURL(png),
        ...normalizeCursor(icon, screen, platform),
        // the shape's own pixels, which is what the hotspot is in when the
        // peer hands the picture to its browser as a CSS cursor
        "imageWidth": icon["width"],
        "imageHeight": icon["height"]
    };
};

export { cursorFingerprint, iconStride, readIcon, cursorScale, normalizeCursor, encodePNG, toDataURL, packCursor };
export default { cursorFingerprint, iconStride, readIcon, cursorScale, normalizeCursor, encodePNG, toDataURL, packCursor };
