"use strict";

// the ffmpeg command lines of the desktop host, one per encoder worth trying,
// in the order they are tried: the first that produces a frame is the one the
// share runs on. Pure - platform and settings in, argument arrays out - so
// tests/stream-ffmpeg.test.js can hold it to what the stream needs of it:
// raw Annex B out of the pipe, a delimiter on every access unit, no B frames,
// a keyframe every second and the bitrate the peer asked for.

// what every line starts with: no probing, no buffering, packets out as they
// are made
const INPUT_FLAGS = [
    "-fflags", "+nobuffer+flush_packets",
    "-flags", "+low_delay",
    "-analyzeduration", "0",
    "-probesize", "32",
    "-thread_queue_size", "8"
];

// and what every line ends with: raw H.264 with an access unit delimiter in
// front of every frame, which is what the splitter in encoder-ffmpeg.js cuts on
const OUTPUT_FLAGS = [
    "-bsf:v", "h264_metadata=aud=insert",
    "-f", "h264",
    "-flush_packets", "1",
    "pipe:1"
];

// the codec the lines below produce, as a WebCodecs decoder wants it named:
// High profile, level 5.1 - the level is what a 4K stream needs and a decoder
// does not refuse a smaller picture under it
const CODEC = "avc1.640033";

// an even number: a hardware encoder takes no odd dimension
const even = function(value) {
    return Math.max(2, Math.round(value / 2) * 2);
};

// the picture the peer asked for, never larger than the screen it is of
const outputSize = function(screen, height) {
    const wanted = Math.min(height, screen["height"]);
    const outHeight = even(wanted);
    const outWidth = even(outHeight * screen["width"] / screen["height"]);
    return {"width": outWidth, "height": outHeight};
};

// the rate control every encoder gets: a constant bitrate with a buffer of one
// frame's worth, so a keyframe cannot borrow from the seconds after it
const rateFlags = function(bitrate, framerate) {
    const kbps = Math.max(200, Math.round(bitrate / 1000));
    return [
        "-b:v", kbps + "k",
        "-maxrate", kbps + "k",
        "-bufsize", Math.max(100, Math.round(kbps / framerate * 2)) + "k",
        "-g", String(framerate),
        "-keyint_min", String(framerate),
        "-bf", "0",
        "-r", String(framerate)
    ];
};

// the lines for one platform. `screen` is the display being shared as
// Control.Screen.list() reports it (logical size, its index in that list),
// `settings` is {bitrate, height, framerate, isCursor}.
const buildLines = function(platform, screen, settings) {
    const size = outputSize(screen, settings["height"]);
    const framerate = settings["framerate"];
    // whether the capture draws the pointer into the picture. Off wherever the
    // host can read its own cursor and send it over instead
    // (src/room/cursor.js), because a pointer inside the video is a pointer a
    // frame late and one that stutters at whatever rate the line is carrying:
    // the peer draws it itself. On only where that is not possible - an addon
    // too old to hand the cursor over - since a share with no pointer at all
    // is worse than a late one.
    const isCursor = (settings["isCursor"] === true);
    const rate = rateFlags(settings["bitrate"], framerate);
    const isScaled = (size["height"] < screen["height"]);
    const lines = [];

    if (platform === "win32") {
        // the capture is a D3D11 texture and it stays one into the hardware
        // encoders: no download to system memory and no upload after it
        const capture = "gfxcapture=monitor_idx=" + screen["index"] + ":capture_cursor=" + (isCursor === true ? "true" : "false") + ":max_framerate=" + framerate;
        lines.push({
            "name": "h264_nvenc",
            "params": [
                ...INPUT_FLAGS,
                "-filter_complex", capture + (isScaled === true ? ",scale_d3d11=w=" + size["width"] + ":h=" + size["height"] : ""),
                "-c:v", "h264_nvenc",
                "-preset", "p1",
                "-tune", "ull",
                "-rc", "cbr",
                "-zerolatency", "1",
                "-delay", "0",
                "-forced-idr", "1",
                "-profile:v", "high",
                ...rate,
                ...OUTPUT_FLAGS
            ]
        });
        lines.push({
            "name": "h264_amf",
            "params": [
                ...INPUT_FLAGS,
                "-filter_complex", capture + (isScaled === true ? ",scale_d3d11=w=" + size["width"] + ":h=" + size["height"] : ""),
                "-c:v", "h264_amf",
                "-usage", "ultralowlatency",
                "-quality", "speed",
                "-rc", "cbr",
                "-profile:v", "high",
                ...rate,
                ...OUTPUT_FLAGS
            ]
        });
        // the software line is the one that always exists: the texture comes
        // down to system memory for it, since that is where x264 works
        lines.push({
            "name": "libx264",
            "params": [
                ...INPUT_FLAGS,
                "-filter_complex", capture + ",hwdownload,format=bgra" + (isScaled === true ? ",scale=w=" + size["width"] + ":h=" + size["height"] : "") + ",format=yuv420p",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-tune", "zerolatency",
                "-profile:v", "high",
                ...rate,
                ...OUTPUT_FLAGS
            ]
        });
    } else if (platform === "darwin") {
        // avfoundation counts screens after the cameras, so the one to grab
        // is named rather than numbered
        const input = [
            "-f", "avfoundation",
            "-capture_cursor", (isCursor === true ? "1" : "0"),
            "-framerate", String(framerate),
            "-i", "Capture screen " + screen["index"] + ":none"
        ];
        const scale = (isScaled === true ? ["-vf", "scale=w=" + size["width"] + ":h=" + size["height"]] : []);
        lines.push({
            "name": "h264_videotoolbox",
            "params": [
                ...INPUT_FLAGS,
                ...input,
                ...scale,
                "-c:v", "h264_videotoolbox",
                "-realtime", "1",
                "-prio_speed", "1",
                "-profile:v", "high",
                "-pix_fmt", "nv12",
                ...rate,
                ...OUTPUT_FLAGS
            ]
        });
        lines.push({
            "name": "libx264",
            "params": [
                ...INPUT_FLAGS,
                ...input,
                ...scale,
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-tune", "zerolatency",
                "-profile:v", "high",
                "-pix_fmt", "yuv420p",
                ...rate,
                ...OUTPUT_FLAGS
            ]
        });
    } else {
        const input = [
            "-f", "x11grab",
            "-draw_mouse", (isCursor === true ? "1" : "0"),
            "-framerate", String(framerate),
            "-video_size", screen["width"] + "x" + screen["height"],
            "-i", ":0.0+" + screen["x"] + "," + screen["y"]
        ];
        const scale = (isScaled === true ? ["-vf", "scale=w=" + size["width"] + ":h=" + size["height"]] : []);
        lines.push({
            "name": "libx264",
            "params": [
                ...INPUT_FLAGS,
                ...input,
                ...scale,
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-tune", "zerolatency",
                "-profile:v", "high",
                "-pix_fmt", "yuv420p",
                ...rate,
                ...OUTPUT_FLAGS
            ]
        });
    }

    return {"lines": lines, "size": size, "codec": CODEC};
};

export { buildLines, outputSize, CODEC };
export default { buildLines, outputSize, CODEC };
