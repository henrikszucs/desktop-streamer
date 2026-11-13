"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { buildLines, outputSize, parseEncoders, CODEC, AUDIO_PCM, listAudioParams, parseAudioDevices, buildAudioLines } from "../src/client/web/src/room/stream-ffmpeg.js";

// The desktop host's ffmpeg lines are the second pure piece of the client:
// platform and settings in, argument arrays out. What has to be true is what
// the stream needs of every line, whichever encoder it names - raw Annex B out
// of the pipe with a delimiter on every access unit, no B frames, a keyframe
// every second and the bitrate the peer asked for - and what the picture
// handed back has to be for the decoder configuration built on it. Every line
// names the encoder it needs, and a build without it never runs the line.

const SCREEN = {"width": 2560, "height": 1440, "x": 0, "y": 0, "index": 0, "isPrimary": true};
const SETTINGS = {"bitrate": 8000000 * 0.9, "height": 1080, "framerate": 30};

// the value behind the last of a flag, or undefined when the flag is not on
// the line: "-f" names the input format too where there is one to name
const valueOf = function(params, flag) {
    const index = params.lastIndexOf(flag);
    return (index === -1 ? undefined : params[index + 1]);
};

test("every line ends in raw Annex B with one delimiter on every access unit", () => {
    // whatever the encoder wrote is taken out before one is put in: Media
    // Foundation writes its own, and a second in front of it is an empty
    // access unit to the splitter
    for (const platform of ["win32", "darwin", "linux"]) {
        for (const line of buildLines(platform, SCREEN, SETTINGS)["lines"]) {
            const params = line["params"];
            assert.equal(valueOf(params, "-f"), "h264", line["name"] + " on " + platform);
            assert.equal(valueOf(params, "-bsf:v"), "h264_metadata=aud=remove,h264_metadata=aud=insert", line["name"] + " on " + platform);
            assert.equal(params[params.length - 1], "pipe:1", line["name"] + " on " + platform);
        }
    }
});

test("every line has no B frames, a keyframe every second and the bitrate asked for", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
        for (const line of buildLines(platform, SCREEN, SETTINGS)["lines"]) {
            const params = line["params"];
            assert.equal(valueOf(params, "-bf"), "0", line["name"] + " on " + platform);
            assert.equal(valueOf(params, "-g"), "30", line["name"] + " on " + platform);
            assert.equal(valueOf(params, "-r"), "30", line["name"] + " on " + platform);
            assert.equal(valueOf(params, "-b:v"), "7200k", line["name"] + " on " + platform);
            assert.equal(valueOf(params, "-maxrate"), "7200k", line["name"] + " on " + platform);
        }
    }
});

test("the capture draws no pointer, unless the host cannot send one itself", () => {
    // the host reads its own cursor and sends it as a picture of its own
    // (src/room/cursor.js), so a pointer inside the video would be a second
    // one, a frame late. The flag is only on where that is not possible.
    const has = function(platform, settings) {
        return buildLines(platform, SCREEN, settings)["lines"].map(function(line) {
            const params = line["params"];
            return (valueOf(params, "-capture_cursor") ?? valueOf(params, "-draw_mouse")
                ?? String(params.join(" ").includes("capture_cursor=true")));
        });
    };
    assert.deepEqual(has("win32", SETTINGS), ["false", "false", "false", "false", "false"]);
    assert.deepEqual(has("darwin", SETTINGS), ["0", "0", "0"]);
    assert.deepEqual(has("linux", SETTINGS), ["0", "0"]);
    assert.deepEqual(has("win32", {...SETTINGS, "isCursor": true}), ["true", "true", "true", "true", "true"]);
    assert.deepEqual(has("darwin", {...SETTINGS, "isCursor": true}), ["1", "1", "1"]);
    assert.deepEqual(has("linux", {...SETTINGS, "isCursor": true}), ["1", "1"]);
});

test("the lines are tried hardware first and end in software", () => {
    const names = function(platform) {
        return buildLines(platform, SCREEN, SETTINGS)["lines"].map(function(line) {
            return line["name"];
        });
    };
    assert.deepEqual(names("win32"), ["h264_nvenc", "h264_amf", "h264_mf hardware", "libx264", "libopenh264"]);
    assert.deepEqual(names("darwin"), ["h264_videotoolbox", "libx264", "libopenh264"]);
    assert.deepEqual(names("linux"), ["libx264", "libopenh264"]);
});

test("every line names the encoder it runs, and asks it for High as the codec says", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
        for (const line of buildLines(platform, SCREEN, SETTINGS)["lines"]) {
            const params = line["params"];
            assert.equal(valueOf(params, "-c:v"), line["encoder"], line["name"] + " on " + platform);
            // Media Foundation has no named profiles: 100 is High's number
            assert.ok(["high", "100"].includes(valueOf(params, "-profile:v")), line["name"] + " on " + platform);
        }
    }
    assert.match(CODEC, /^avc1\.64/);
});

test("every line logs its errors alone, which is what a line that fails is reported with", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
        for (const line of buildLines(platform, SCREEN, SETTINGS)["lines"]) {
            const params = line["params"];
            assert.equal(valueOf(params, "-loglevel"), "error", line["name"] + " on " + platform);
            assert.ok(params.includes("-hide_banner") && params.includes("-nostats"), line["name"] + " on " + platform);
        }
    }
});

// `ffmpeg -hide_banner -encoders` of the build shipped for win32-x64, cut
const WIN32_ENCODERS = [
    "Encoders:",
    " V..... = Video",
    " A..... = Audio",
    " ------",
    " V....D a64multi             Multicolor charset for Commodore 64 (codec a64_multi)",
    " V....D libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)",
    " V....D h264_amf             AMD AMF H.264 Encoder (codec h264)",
    " V....D h264_mf              H264 via MediaFoundation (codec h264)",
    " V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)",
    " V..... h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video acceleration) (codec h264)",
    " A....D aac                  AAC (Advanced Audio Coding)",
    " S..... ass                  ASS (Advanced SubStation Alpha) subtitle"
].join("\r\n");

test("the video encoders are read out of the listing, and nothing else is", () => {
    const encoders = parseEncoders(WIN32_ENCODERS);
    assert.deepEqual([...encoders], ["a64multi", "libopenh264", "h264_amf", "h264_mf", "h264_nvenc", "h264_qsv"]);
    assert.equal(parseEncoders("").size, 0);
});

test("the build shipped for Windows has no x264, and its lines still end in software", () => {
    // the line that used to be the last one is the one this build cannot run:
    // a share whose GPU encoder was taken fell through to nothing
    const encoders = parseEncoders(WIN32_ENCODERS);
    const lines = buildLines("win32", SCREEN, SETTINGS)["lines"].filter(function(line) {
        return encoders.has(line["encoder"]);
    });
    assert.deepEqual(lines.map((line) => line["name"]), ["h264_nvenc", "h264_amf", "h264_mf hardware", "libopenh264"]);
});

test("the picture is the height asked for at the screen's ratio, even both ways", () => {
    assert.deepEqual(outputSize(SCREEN, 1080), {"width": 1920, "height": 1080});
    assert.deepEqual(outputSize({"width": 1366, "height": 768}, 720), {"width": 1280, "height": 720});
    const size = outputSize({"width": 1440, "height": 900}, 1080);
    assert.equal(size["width"] % 2, 0);
    assert.equal(size["height"] % 2, 0);
});

test("a picture is never larger than the screen it is of, and then nothing scales", () => {
    const built = buildLines("darwin", {"width": 1920, "height": 1080, "index": 1}, {...SETTINGS, "height": 1440});
    assert.deepEqual(built["size"], {"width": 1920, "height": 1080});
    for (const line of built["lines"]) {
        assert.equal(line["params"].includes("-vf"), false);
    }
});

test("a smaller picture is scaled on every line, on the GPU where the capture is", () => {
    // by the capture itself on Windows, ahead of any download: scale_d3d11
    // after it cannot make its output texture from the capture's frames, and
    // every line that asked it to failed on the spot
    const win = buildLines("win32", SCREEN, {...SETTINGS, "height": 720});
    assert.deepEqual(win["size"], {"width": 1280, "height": 720});
    for (const line of win["lines"]) {
        const graph = valueOf(line["params"], "-filter_complex");
        assert.match(graph, /^gfxcapture=[^,]*:width=1280:height=720:resize_mode=scale/, line["name"]);
        assert.doesNotMatch(graph, /scale_d3d11|,scale=/, line["name"]);
    }
    for (const line of buildLines("win32", SCREEN, {...SETTINGS, "height": SCREEN["height"]})["lines"]) {
        assert.doesNotMatch(valueOf(line["params"], "-filter_complex"), /width=|resize_mode/, line["name"]);
    }
    const mac = buildLines("darwin", SCREEN, {...SETTINGS, "height": 720});
    for (const line of mac["lines"]) {
        assert.equal(valueOf(line["params"], "-vf"), "scale=w=1280:h=720");
    }
});

test("the display shared is the one named, on each platform's own capture", () => {
    const screen = {...SCREEN, "index": 2, "x": 2560, "y": 0};
    assert.match(valueOf(buildLines("win32", screen, SETTINGS)["lines"][0]["params"], "-filter_complex"), /^gfxcapture=monitor_idx=2:/);
    assert.equal(valueOf(buildLines("darwin", screen, SETTINGS)["lines"][0]["params"], "-i"), "Capture screen 2:none");
    assert.equal(valueOf(buildLines("linux", screen, SETTINGS)["lines"][0]["params"], "-i"), ":0.0+2560,0");
});

test("the codec named is the one a WebCodecs decoder is configured with", () => {
    assert.equal(buildLines("win32", SCREEN, SETTINGS)["codec"], CODEC);
    assert.match(CODEC, /^avc1\./);
});

test("a bitrate under the floor is lifted to it rather than starving the encoder", () => {
    const params = buildLines("linux", SCREEN, {...SETTINGS, "bitrate": 50000})["lines"][0]["params"];
    assert.equal(valueOf(params, "-b:v"), "200k");
});

//
// the sound lines: the fallback when Chromium's loopback capture is not there
//
const DSHOW_LISTING = [
    "[dshow @ 000001a105ddd1c0] Could not enumerate video devices (or none found).",
    "[dshow @ 000001a105ddd1c0] \"Mikrofon (Steam Streaming Microphone)\" (audio)",
    "[dshow @ 000001a105ddd1c0]   Alternative name \"@device_cm_{33D9A762}\wave_{094F3620}\"",
    "[dshow @ 000001a105ddd1c0] \"Stereomix (Realtek(R) Audio)\" (audio)",
    "[dshow @ 000001a105ddd1c0] \"CABLE Output (VB-Audio Virtual Cable)\" (audio)",
    "Error opening input file dummy."
].join("\r\n");

const DSHOW_OLD_LISTING = [
    "[dshow @ 0000] DirectShow video devices (some may be both video and audio devices)",
    "[dshow @ 0000]  \"Integrated Camera\"",
    "[dshow @ 0000] DirectShow audio devices",
    "[dshow @ 0000]  \"Stereo Mix (Realtek High Definition Audio)\"",
    "[dshow @ 0000]     Alternative name \"@device_cm_{33D9A762}\"",
    "[dshow @ 0000]  \"Microphone (Realtek High Definition Audio)\""
].join("\n");

const AVFOUNDATION_LISTING = [
    "[AVFoundation indev @ 0x7f8] AVFoundation video devices:",
    "[AVFoundation indev @ 0x7f8] [0] FaceTime HD Camera",
    "[AVFoundation indev @ 0x7f8] [1] Capture screen 0",
    "[AVFoundation indev @ 0x7f8] AVFoundation audio devices:",
    "[AVFoundation indev @ 0x7f8] [0] BlackHole 2ch",
    "[AVFoundation indev @ 0x7f8] [1] MacBook Pro Microphone",
    ": Input/output error"
].join("\n");

test("the audio devices are read out of both dshow listings, and not the cameras", () => {
    assert.deepEqual(parseAudioDevices("win32", DSHOW_LISTING), [
        "Mikrofon (Steam Streaming Microphone)",
        "Stereomix (Realtek(R) Audio)",
        "CABLE Output (VB-Audio Virtual Cable)"
    ]);
    assert.deepEqual(parseAudioDevices("win32", DSHOW_OLD_LISTING), [
        "Stereo Mix (Realtek High Definition Audio)",
        "Microphone (Realtek High Definition Audio)"
    ]);
});

test("the audio devices are read out of the avfoundation listing, and not the screens", () => {
    assert.deepEqual(parseAudioDevices("darwin", AVFOUNDATION_LISTING), ["BlackHole 2ch", "MacBook Pro Microphone"]);
});

test("only a device that carries the system's output becomes a line, never a microphone", () => {
    const win = buildAudioLines("win32", parseAudioDevices("win32", DSHOW_LISTING));
    assert.deepEqual(win.map((line) => valueOf(line["params"], "-i")), [
        "\"audio=Stereomix (Realtek(R) Audio)\"",
        "\"audio=CABLE Output (VB-Audio Virtual Cable)\""
    ]);
    const mac = buildAudioLines("darwin", parseAudioDevices("darwin", AVFOUNDATION_LISTING));
    assert.deepEqual(mac.map((line) => valueOf(line["params"], "-i")), [":BlackHole 2ch"]);
    assert.deepEqual(buildAudioLines("win32", ["Microphone (USB)"]), []);
});

test("linux takes the default sink's monitor from pulse and needs no listing", () => {
    assert.equal(listAudioParams("linux"), null);
    const lines = buildAudioLines("linux");
    assert.equal(lines.length, 1);
    assert.equal(lines[0]["params"][lines[0]["params"].indexOf("-f") + 1], "pulse");
    assert.equal(valueOf(lines[0]["params"], "-i"), "@DEFAULT_MONITOR@");
});

test("every sound line writes the one PCM format the host encodes", () => {
    const lines = [
        ...buildAudioLines("win32", ["Stereo Mix"]),
        ...buildAudioLines("darwin", ["BlackHole 2ch"]),
        ...buildAudioLines("linux")
    ];
    for (const line of lines) {
        const params = line["params"];
        assert.equal(params.at(-1), "pipe:1", line["name"]);
        assert.equal(params[params.lastIndexOf("-f") + 1], "f32le", line["name"]);
        assert.equal(valueOf(params, "-ar"), String(AUDIO_PCM["sampleRate"]), line["name"]);
        assert.equal(valueOf(params, "-ac"), String(AUDIO_PCM["numberOfChannels"]), line["name"]);
        assert.ok(params.includes("-vn"), line["name"]);
    }
});
