# Room media: the stream, the control protocol and the two legs under them

**Built** - steps 1 to 7 of the order below are in the tree (`src/client/web/src/room/stream.js`
and the `frame.js`, `stream-worker.js`, `stream-draw.js`, `stream-ffmpeg.js`,
`stream-input.js` beside it; `.claude/CLIENT.md`, "The stream", is the record
of what landed). What differs from the text below, and what is still open, is
listed under **What landed** at the end; the design is kept as written.

What the two ends do with the room once it stands. Today `ctx["room"]`
(`src/client/web/src/room/room.js`) proves a path - a `control` data channel synced
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

## The rule

**The stream is bytes over the data path, never a WebRTC media track.** The
`RTCPeerConnection` carries data channels and nothing else, on every host and
on every peer; `addTrack`, `ontrack` and `srcObject` do not appear in the
stream module. The reason is the one thing this product is measured on: a
media track puts an encoder pacer, an RTP layer and a jitter buffer between the
capture and the pixel, each of them a queue tuned for a video call and none of
them one this code can empty. Raw encoded frames over an unreliable channel,
with the drop rule below and a decoder this code feeds and drains itself, is
how the latency stays at capture + encode + line + decode + one vsync and
nothing more.

## The module

`src/client/web/src/room/stream.js` - `ctx["stream"]`, built by `index.js` after
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

**No WebRTC media track, on either host.** `addTrack` with a
`desktopCapturer` / `getDisplayMedia` track would hand the browser's own
encoder, congestion control and jitter buffer over for free, and every one of
those is a queue this project cannot see into or turn off: the jitter buffer
alone holds a frame for tens of milliseconds by design, the encoder's pacer and
the RTP layer add their own, and the encoder settings a remote desktop wants
(intra refresh, keyframe on request, a bitrate the peer sets, a frame dropped
rather than queued) are not reachable through `RTCRtpSender`. A remote desktop
is not a video call: the latency floor is the product, and the media stack's
floor is the wrong one. So **every host sends raw encoded bytes** over the
`video` channel and the relay - the desktop host from ffmpeg, the web host from
WebCodecs `VideoEncoder` - and the peer draws frames it decoded itself. It also
means a relayed room and a direct one carry the same bytes, and the decoded
`VideoFrame`s the model work needs are already in hand. Two encoders, one
wire format, one decoder.

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
  the frame rate from the bar (24 to 120). A settings change restarts the encoder
  behind the current keyframe, not the capture.
- Mux to raw Annex-B (`-f h264`) and split on start codes; `-f mp4` and the
  box parser go. The SPS/PPS that arrive with each IDR are the decoder config
  (`avcC` built from them once, sent as a `config` frame, and re-sent on every
  keyframe so a peer that arrives mid-stream can start). Audio is ffmpeg's
  Opus in Ogg, parsed as `FFmpegAudioEncoder` already does, on the same channel.
- Frames are cut on the ffmpeg pipe and sent as they are cut, on the renderer -
  the pipe is a stream and the cut is a scan for a start code, not a copy.

**Web host** (browser, no ffmpeg): `getDisplayMedia` for the capture and
WebCodecs for the encode, and nothing of the stream ever touches the
`RTCPeerConnection`'s media side. The track goes through a
`MediaStreamTrackProcessor` (`encoder-browser.js` already does this for
audio), each `VideoFrame` into a `VideoEncoder` configured
`{"codec": "avc1.640033", "hardwareAcceleration": "prefer-hardware",
"latencyMode": "realtime", "bitrate", "framerate", "avc": {"format": "annexb"}}`
- Annex-B so the chunks are the same bytes the desktop host sends and the
peer has one parser - and every `EncodedVideoChunk` goes out the same `video`
channel under the same header. `latencyMode: "realtime"` is what makes the
encoder emit a frame per input rather than buffer for quality;
`VideoEncoder.encode(frame, {"keyFrame": true})` is the keyframe on request;
a change from `setSettings` is `configure()` again on the live encoder. The
`decoderConfig` the encoder hands back with its first chunk is the `config`
frame. Where `VideoEncoder` does not exist the shares screen says the browser
cannot share, rather than offering a share that would need the media stack to
draw. A frame the channel is not ready for is `close()`d and skipped, the
same backpressure rule as the desktop host.

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

- Present through a `<canvas>` that replaces `#room-video` - nothing hands
  this screen a media track any more, so the element goes - drawn with WebGPU
  `importExternalTexture` where there is a `GPUDevice` and WebGL
  `texImage2D(videoFrame)` where there is not: zero copy either way, and it
  works in every browser that has `VideoDecoder`. `MediaStreamTrackGenerator`
  goes: it is Chromium only and it is one more queue between the decoder and
  the pixel. `requestAnimationFrame` paces the draw; a frame older than one
  display interval when it is drawn is skipped for the next. The canvas is an
  `OffscreenCanvas` transferred to the Worker so the draw never waits on the
  room UI's main thread either.
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
6. The web host through `VideoEncoder` - the same `stream.js` `share`, a
   second encoder behind it, no new wire format.
7. Audio.
8. The upscaler - its own plan when the benchmark has a number.

## What landed

The design above, with these differences:

- **The header is as specified** and the reassembler holds `HOLD = 2` frames;
  audio and video unwrap their timestamps on separate clocks, since the host
  stamps them from two sources. A `CONFIG` frame is JSON and rides ahead of
  every keyframe.
- **The desktop host does not honour a keyframe request** - ffmpeg cannot be
  told anything over a pipe, and intra refresh was dropped because a stream
  with no IDR after the first cannot be joined late. The GOP is one second and
  that is the answer to a gap. The web host honours it (`keyFrame: true`).
- **The access unit splitter is one frame behind the encoder.** Raw Annex B has
  no length in front of a unit, so a unit is only known whole when the next
  delimiter arrives: 33 ms at 30 fps. A length-framed container (fragmented
  MP4 was what the old parser read) would remove that at the cost of a parser
  and an `avcC` description; measure before choosing.
- **The socket packet is 64 KB with 64 in flight** rather than the 16 KB the
  text names: the relay's chunk is the whole frame, so the packet is sized for
  a frame rather than a channel chunk.
- **The desktop host captures no sound.** ffmpeg's system audio input differs
  per platform (none built in on macOS without a loopback device) and none is
  wired; the web host's display audio goes through an `AudioEncoder` as Opus.
- **Control is gated on the host having easy-control**, not on a per-join tick
  the joins table does not carry; a browser host applies nothing.
- **The host shares its primary display**; `room/settings` is still the empty
  dialog that would choose one. The settings preview chooses by index.
- **A share that cannot start leaves the room** (the picker cancelled, no
  encoder line opened), with a snackbar on the host.
- **WebGPU is what a Chromium headless run drew through** in the in-page check;
  WebGL and 2D are the fallbacks and were not exercised against a real frame.
- **The room bar carries a frame rate** (24, 30, 45, 60, 120; `FRAMERATES` in
  `ui/room/index.js`) in the same `settings` message, unpriced: the encoder
  spends the same bitrate over more frames. The desktop host restarts ffmpeg
  for it; the web host re-constrains the captured track and reconfigures.
- `QUEUE_MAX` is 8 rather than 2: a burst of a few frames is a hiccup a
  hardware decoder clears on its own, and dropping a delta forces a keyframe
  wait a desktop host takes a second to end.

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
