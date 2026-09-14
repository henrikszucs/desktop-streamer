# Room media: the stream, the control protocol and the two legs under them

What the two ends do with the room once it stands. Today `ctx["room"]`
(`src/client/web/src/room.js`) proves a path - a `control` data channel synced
over, or the server's relay - and carries nothing on it: the room screen draws a
bar whose `settings` event nobody listens to, `#room-video` never gets a
`srcObject`, and the ffmpeg encoder and the WebCodecs decoder only meet each other
in the settings preview, on one machine. This plan is the module that closes that
loop, and the transport changes the loop needs before it can be low latency.

Depends on nothing open: [ws-pairing-joins.md](ws-pairing-joins.md) is done and
the room is the seam it left (`getConnection()`, `getChannel()`, `send()`,
`message`). What it changes on the server is one number.

## Where it stands, measured

- **Relay throughput is capped by the socket's packet layer, not by the server.**
  Both socket communicators run `packetSize: 1000`, `sendThreads: 16`, every
  packet acknowledged (`src/client/web/src/server.js`, `src/server/ws/ws.js`).
  That is a 16 KB window per round trip: ~2.5 Mbps at 50 ms RTT, under the
  1 Mbps floor of the room bar at 150 ms. The 16 MB / 600 ms figure in
  `tests/relay.test.js` is an in-process number with no RTT in it. The server
  side (`roomFrame`) forwards a frame one way and waits on nothing, so the
  ceiling is entirely the client's.
- **The direct leg is reliable twice.** The `control` channel is ordered and
  reliable SCTP, and the `Communicator` over it adds its own ack, retry
  (`packetRetry: Infinity`) and a 60 s `DATA_TIMEOUT`. For control messages
  that is right. For video it is head-of-line blocking twice over and a frame
  that is late is delivered anyway.
- **The encoder is a preview, not a stream.** `ui/management/settings/video/`
  spawns ffmpeg with a hardcoded 1080p / 10 Mbps / 30 fps / keyframe every
  0.5 s line, `hwdownload,format=bgra` between `gfxcapture` and `h264_nvenc` on
  Windows (the captured D3D11 texture is pulled to CPU and NVENC uploads it
  again), NVIDIA only, and an fMP4 box parser (`encoder-ffmpeg.js`) that
  re-copies its whole buffer per stdout chunk, assumes a 90000 timescale and
  skips an unknown box by 7 bytes. A web host has no video encoder at all -
  `encoder-browser.js` is audio only.
- **The decoder has the right flags and no queue.** `prefer-hardware`,
  `optimizeForLatency`, keyframe wait, recreate on error - and `decodeQueueSize`
  never read, so a slow decoder accumulates delay instead of dropping. Output
  goes through `MediaStreamTrackGenerator`, which is Chromium only; the
  portable canvas `Player` beside it is unused.
- **Control is a button.** `setControl` toggles an icon; `easy-control` is
  loaded onto `ctx["desktop"]` and only `Screen.list()` is ever called.
- `desktopCapturer` is imported in `src/client/electron/main.js` and unused.

The codec work is already on hardware (NVENC / VideoToolbox on the host, the
browser's decoder behind `VideoDecoder`). WebGL and WebGPU do not encode or
decode; what they are for is everything around the codec - keeping the frame on
the GPU from decode to pixel, and the `model/` upscaling that will consume that
texture. So the order below is transport, encoder, presentation, and only then
GPU compute: nothing a shader does helps a frame that waited on an ack.

## The module

`src/client/web/src/stream.js` - `ctx["stream"]`, built by `index.js` after
`ctx["room"]` and closing over it. One object with two halves that are never
both live on one client:

```
stream.share(settings)      host: capture + encode + send, until stop()
stream.watch(video)         peer: receive + decode + present into a <video>/<canvas>
stream.stop()
stream.setSettings(s)       peer: what the room bar asked for, sent to the host
stream.sendInput(event)     peer: one control message, over the control channel
events: "started", "stopped", "stats" ({fps, bitrate, rtt, dropped, mode})
```

It reads `ctx["room"]` for the leg (`isRelay()`, `getConnection()`,
`getChannel()`) and `ctx["desktop"]` for the encoder and `Control`. The room
screen becomes its one caller: `open()` with a connected room calls `watch`
(peer) and the shares side of the shell calls `share` (host) on `connected`;
the bar's `settings` event is `setSettings`. `room.js` keeps owning the
connection and gains nothing but a second channel (below).

## Transport

Two channels on the direct leg, one frame kind on the relay.

**`control`** stays exactly as it is - ordered, reliable, `Communicator` on
top, `send()`/`message`. It carries the control protocol, the settings and the
keyframe request. It is the one place an answer is wanted.

**`video`** is new: `createDataChannel("video", {"ordered": false,
"maxRetransmits": 0})`, opened by the offerer beside `control` and not wrapped
in anything. A frame is sent as chunks of at most `CHANNEL_PACKET_SIZE`
(16000 B) with a 12-byte header of the module's own:

```
u32 frameSeq      wraps; one per encoded frame
u16 chunkIndex
u16 chunkCount
u8  flags         bit 0 keyframe, bit 1 audio, bit 2 config
u24 timestampLo   microseconds mod 2^24, the decoder timestamp
```

The receiver reassembles by `frameSeq`, delivers a frame when every chunk is
in, **drops a delta frame** that is incomplete when the next `frameSeq` starts
arriving, and after a drop waits for the next keyframe and asks for one on
`control` (`{"kind": "keyframe"}`) - once per gap, not per chunk. Audio is the
same channel with the audio flag; its frames are small enough that the loss of
one is a click rather than a stall. Backpressure is `bufferedAmount` against a
`bufferedAmountLowThreshold` of two frames' worth: a host that is ahead of the
line drops the *encoded* frame rather than queueing it.

**The relay** carries the same bytes as `FRAME_DATA` frames through
`roomDataSend` - the 12-byte header sits behind the server's 11 - and the server
changes nothing but the socket's packet layer: `packetSize` goes from 1000 to
`65536` on both ends, and `sendThreads` to 64. The number 1000 was chosen for a
proxy nobody has named; a WebSocket frame is not limited to it. With 16 KB
video chunks, one chunk is one packet and a frame of 100 KB is six in flight
rather than a hundred acked one by one. That is the whole server-side change,
and `tests/relay.test.js` covers it as it stands. The relay stays reliable and
ordered - it is a socket - so a relayed room has more latency than a direct
one by design; what this buys is that it is not also starved.

**What is decided against.** `addTrack` with a `desktopCapturer` /
`getDisplayMedia` track would hand the browser's own encoder, congestion control
and jitter buffer over for free and is the right thing for a **web host**, which
has no ffmpeg - so it is the web host's path (below) and nothing else. It is not
the desktop path because the frames the model work will need are the decoded
`VideoFrame`s, and a media track hands out a `<video>`, not frames, without a
`MediaStreamTrackProcessor` in the way; because the encoder settings a remote
desktop wants (intra refresh, keyframe on request, a bitrate the peer sets) are
not reachable through `RTCRtpSender`; and because a relayed room has no media
track at all, so the frame path has to exist anyway. Two encoders, one wire
format.

## The host

**Desktop host** (`ctx["desktop"].isAvailable`): ffmpeg, kept, moved out of the
settings preview into `stream.js` and driven by the peer's settings.

- Capture and encode stay on the GPU: on Windows `gfxcapture` straight into
  `h264_nvenc` with **no `hwdownload`** (NVENC takes D3D11 surfaces); the
  scale is `scale_cuda` / `scale_d3d11` behind it rather than in the encoder.
  On macOS `avfoundation` into `h264_videotoolbox` with `scale_vt`. The encoder
  is probed at start in order - `h264_nvenc`, `h264_amf`, `h264_qsv`,
  `h264_videotoolbox`, then `libx264 -preset ultrafast -tune zerolatency` -
  and the first that opens is the one. A probe is a one-frame encode from
  `-f lavfi -i color`, ~100 ms, done once per `share`.
- Long GOP with `-intra-refresh 1` (nvenc, x264) or `-g 600` where the encoder
  has no refresh, `-forced-idr 1`, and a keyframe when `control` asks for one -
  ffmpeg is told through a filter reload on the pipe rather than restarted. The
  0.5 s keyframe interval goes: it is a keyframe every fifteen frames, each
  five to ten deltas' worth of bytes, spent on nothing.
- Bitrate and height come from `setSettings` (`bandwidth` in Mbps, `height`),
  the frame rate from the display. A settings change restarts the encoder
  behind the current keyframe, not the capture.
- Mux to raw Annex-B (`-f h264`) and split on start codes; `-f mp4` and the
  box parser go. The SPS/PPS that arrive with each IDR are the decoder config
  (`avcC` built from them once, sent as a `config` frame, and re-sent on every
  keyframe so a peer that arrives mid-stream can start). Audio is ffmpeg's
  Opus in Ogg, parsed as `FFmpegAudioEncoder` already does, on the same channel.
- Frames are cut on the ffmpeg pipe and sent as they are cut, on the renderer -
  the pipe is a stream and the cut is a scan for a start code, not a copy.

**Web host** (browser, no ffmpeg): `getDisplayMedia` and `addTrack` on the
room's `RTCPeerConnection`, renegotiated over `room-signal` the way the offer
was - the browser encodes, adapts and jitter-buffers. On the peer the track is
the `<video>`'s `srcObject` and `watch` does nothing else. A web host on a
relayed room shares nothing: there is no media track through a socket, and the
shares screen says so rather than starting a share that never draws.

**Control**: the host runs `easy-control` from messages on `control` -
`{"kind": "input", ...}` with the `Control` API's own event shapes, translated
from the peer's pointer and key events against the video element's rectangle.
A host that did not tick control for this join drops them. The peer's control
button is what starts sending them and nothing else.

## The peer

`watch(video)` builds the decoder (the `Decoder` class of
`libs/ffmpeg-chunkifier/decoder.js`, `prefer-hardware`,
`optimizeForLatency`) **in a Worker**, receives chunks off the `video`
channel or the room's `message` event, reassembles, and presents:

- Present through a `<canvas>` behind `#room-video`, drawn with WebGPU
  `importExternalTexture` where there is a `GPUDevice` and WebGL
  `texImage2D(videoFrame)` where there is not - zero copy either way and it
  works in every browser that has `VideoDecoder`. `MediaStreamTrackGenerator`
  goes: it is Chromium only and it is one more queue. `requestAnimationFrame`
  paces the draw; a frame older than one display interval when it is drawn is
  skipped for the next.
- Queue discipline: when `decodeQueueSize` is above 2 the decoder is not fed
  delta frames until the next keyframe, which is asked for on `control`.
  Latency is what is being bought, and a late frame is worth nothing.
- Audio through the `Player` scheduling already in `decoder.js`, with a
  jitter target of 60 ms rather than "next slot": the current code plays a
  frame the moment it decodes and gaps on the first late one.
- `stats` every second from what the Worker counts, for the room bar's
  tooltip and for deciding whether the auto resolution should step down.

**GPU compute** - the `model/` upscaler and frame generation - hangs off the
canvas path and nothing else: the decoded `VideoFrame` is imported as a
texture, the ONNX Runtime Web session on the WebGPU EP runs over it, and the
result is what is drawn. It is a stage after this plan, gated on a browser
measurement from `model/upscale/benchmark/` that does not exist yet (every
recorded number is a CPU torch number), and the plan here only has to leave the
frame on the GPU for it.

## Order

1. `stream.js` skeleton, the `video` channel in `room.js`, the frame header
   and reassembly with the drop rule - tested with a synthetic frame source in
   `tests/` the way `relay.test.js` tests the relay (the reassembler is pure
   and runs under Node).
2. The socket packet size on both ends; `tests/relay.test.js` as the check.
3. The desktop host: ffmpeg into Annex-B, the probe, settings from the bar, no
   `hwdownload`. The settings preview switches to `stream.js` so there is one
   ffmpeg line in the tree.
4. The peer: decoder in a Worker, canvas presentation, queue discipline.
   First picture across a room lands here.
5. Control over the `control` channel; the host-side gate.
6. The web host through `addTrack`.
7. Audio.
8. The upscaler - its own plan when the benchmark has a number.

## Open

- Whether a relayed stream should be told to the host as a lower bitrate cap
  than the peer asked for: the relay is reliable and a socket, so a bitrate the
  server's link cannot carry queues rather than drops. A `stats` RTT that grows
  is the signal; the auto resolution stepping down is the answer, and it is the
  peer's to make.
- `CHANNEL_PACKET_SIZE` is 16000 for SCTP's sake; `maxMessageSize` from the
  SDP would allow larger on most pairs. Not worth reading until it is measured.
- Whether the encoder probe order should be the user's, in `settings.video`.
- AV1 (`av1_nvenc`, `av1_videotoolbox` on M3+) at the same bitrates: better
  picture, later; `VideoDecoder` support is broad enough now that the wire
  format should carry a codec string in its `config` frame from the start
  rather than assume `avc1`.
