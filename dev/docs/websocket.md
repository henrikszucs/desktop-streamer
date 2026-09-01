# WebSocket communication

How the browser/Electron client and the Node server talk to each other, from the
socket up to the message types they exchange. This describes what the code does
today, not what is planned - for the parts that were removed and are waiting to
be restored see [../plans/README.md](../plans/README.md).

## The three layers

```
    application    {"type": "conf-get"}  ->  {"webrtc": {...}, "permissions": {...}}
                   src/server/ws.js  <->  src/client/web/src/server.js
    ----------------------------------------------------------------------------
    communicator   packets, acks, retries, split, message ids, invoke/answer
                   src/server/communicator.js  <->  libs/communicator/communicator.js
    ----------------------------------------------------------------------------
    transport      one wss:// WebSocket, text frames for JSON, binary for the rest
```

The two `communicator.js` files are vendored copies of the maintainer's own
`easy-communicator` (LGPL-3.0-or-later, see the SPDX headers). **They implement
the same protocol and have to stay in sync** - a change to one is a change to
both. They are also intended to back WebRTC data channels later, which is why
the protocol knows nothing about WebSockets: it only calls a `sender` function.

| side | files |
| --- | --- |
| server | [`src/server/ws.js`](../../src/server/ws.js), [`src/server/communicator.js`](../../src/server/communicator.js) |
| client | [`src/client/web/src/server.js`](../../src/client/web/src/server.js), [`src/client/web/libs/communicator/communicator.js`](../../src/client/web/libs/communicator/communicator.js) |

## Where the address comes from

The client never hard-codes the server. `ServerHTTP.start` writes
`tmp/web/config.json` at boot with the WS endpoint in it, and the client fetches
that file at load time (`src/client/web/src/conf.js`):

```json
{"http": {"clients": ["win32-x64.zip"], "version": "0.0.2"},
 "ws": {"domain": "localhost", "port": 8444}}
```

`index.js` then builds the URL and hands it to the transport:

```js
server.connect("wss://" + conf["ws"]["domain"] + ":" + conf["ws"]["port"]);
```

The port is always appended, `443` included. On the server side the WS endpoint
is either its own HTTPS listener (`ws.port`, answering an empty `200` to normal
requests) or an upgrade on the HTTP server's existing listener when
`http.port === ws.port` - `config.js` allows those two to collide and nothing
else to.

## Connection lifecycle

```
client                                                    server
  |                                                          |
  |---- WebSocket handshake (wss) -------------------------->|  clientConnect()
  |                                                          |  sessionId = generateSessionId()
  |                                                          |  new Communicator per connection
  |                                                          |
  |<=== side sync (both sides start one) ===================>|  random UIDs decide who owns
  |                                                          |  which message id parity
  |<=== time sync ==========================================>|  clock offset for sendTime
  |                                                          |
  |---- invoke {"type": "conf-get"} ------------------------>|  handleAPI()
  |<--- answer {"webrtc": ..., "permissions": ...} ----------|
  |                                                          |
  | isOnline = true, dispatch "online"                       |
  |                                                          |
  |---- further invokes ------------------------------------>|
  |<--- answers --------------------------------------------|
  |                                                          |
  |<--- close / error --------------------------------------|  ws "close": release the
  | dispatch "offline", retry after 2000 ms                  |  communicator, drop the client
```

Both sides run `sideSync()` and `timeSync()` themselves as soon as the socket is
open - the server in `clientConnect`, the client in its `open` listener. Each
side answers the other's request, so the two runs interleave harmlessly.

**The client stays offline until `conf-get` answers.** If that call errors or
comes back as anything but an object it closes the socket, which means the retry
loop below starts and the loading dialog never goes away. A missing `conf-get`
on the server is therefore indistinguishable from an unreachable server.

The client keeps **one** `Communicator` for the life of the page and a new
`WebSocket` per attempt: `reconnect()` closes the old socket, opens a new one,
re-points the communicator's `sender` at it and re-runs both syncs. The server
builds a fresh `Communicator` per connection and `release()`s it on close.

Reconnect is a flat 2 s retry with no backoff and no attempt limit
(`handleDisconnection` in `server.js`).

## Transport adapters

The communicator is transport agnostic: it hands out either an `ArrayBuffer` or
a plain JS array, and the glue on each side decides how that becomes a frame.

**Sending** - identical on both sides:

```js
"sender": async function(data, transfer, message) {
    if ((data instanceof ArrayBuffer) === false) {
        data = JSON.stringify(data);
    }
    ws.send(data);
}
```

So an `ArrayBuffer` goes out as a **binary frame** and everything else as a
**text frame** holding a JSON array.

**Receiving** - the client sets `binaryType = "arraybuffer"` and only has to
parse the text case. The server has to convert:

```js
data = new Uint8Array(data);   // node Buffer -> copy
data = data.buffer;            // exact-size ArrayBuffer
```

The copy is not redundant. `ws` hands over a node `Buffer`, whose `.buffer` is
the shared allocation pool slab, not just this message - passing it straight
through would give the communicator the wrong bytes and the wrong length.

## The communicator protocol

### Frame forms

A frame is either a JSON array or a binary buffer. In the binary form **the
header is a trailer**: the payload sits at the front and every header field is
addressed backwards from the end of the buffer (`byteLength - n`), so a packet
can be built by writing the payload first and stamping the header on after.

JSON array form (used for any message that is not an `ArrayBuffer`):

```
[flags, sendTime, messageId, (answerFor), payload]
```

JSON messages are never split and never carry sync frames - `packetSize` does
not apply to them, and one message is always exactly one packet.

### Flag bits

The flags byte is `msg[0]` in the array form and the **last byte** of a binary
frame.

| bit | value | meaning |
| --- | --- | --- |
| 0 | 1 | time sync |
| 1 | 2 | side sync |
| 2 | 4 | invoke (an answer is expected) |
| 3 | 8 | split (this message is more than one packet) |
| 4 | 16 | abort |
| 5 | 32 | answer (this is the reply to `answerFor`) |

Time sync and side sync are checked first and are mutually exclusive with the
rest - a sync frame carries no message id.

### Binary layouts

Offsets are counted back from the end of the buffer, the way the code reads
them.

| frame | size | fields (from the end) |
| --- | --- | --- |
| time sync | 25 B | `-1` flags=1, `-9` f64 my time, `-17` f64 other time (`-1` in a request) |
| side sync request | 13 B | `-1` flags=2, `-5` u32 my time, `-9` u32 my UID, `-13` u32 other UID = 0 |
| side sync answer | 25 B | same trailing 13 bytes, other UID filled in (the leading 12 B are unused) |
| ack | 11 B | `-1` flags (0, or 8 when split), `-5` u32 send time, `-9` u32 message id, `-11` u16 packet id when split |
| data packet | payload + 9…17 B | `-1` flags, `-5` u32 send time, `-9` u32 message id, `-11` u16 packet id and `-13` u16 packet count when split, then u32 `answerFor` when the answer flag is set |

The packet count is only written on the first packet of a message
(`packetId === 0`), and the reader only looks for it on a packet the peer
originated.

### Side sync - who owns which message ids

Each side picks a random 32-bit UID and sends it; the peer echoes it back with
its own. The side with the **greater** UID takes `myReminder = 1`, the other
`0`, and from then on allocates message ids of that parity, stepping by 2. So
the two sides can never hand out the same id, and a receiver can tell at a
glance what an incoming frame is:

```js
if (messageId % 2 === this.myReminder) { /* an ack or abort for MY message */ }
else                                    { /* the peer's message */ }
```

If both sides happen to draw the same UID, the initiator re-rolls and retries -
five attempts, then one last wait of `interactTimeout`.

**Nothing can be sent before side sync completes**, and it has to be redone on
every reconnect, because the id parity is what routes every later frame.

### Time sync - why every packet carries a timestamp

The requester sends its own clock and `-1`; the peer echoes that and appends its
own clock; the requester computes

```
timeOffset = (peer time + round trip / 2) - now
```

Every packet then stamps `sendTime = (Date.now() + timeOffset) % 4294967295`, and
a receiver **drops any packet whose `sendTime` is outside `interactTimeout`**,
logging `outdated packet`. Time sync is therefore not optional: without it two
machines with a clock skew larger than 3 s would silently discard every frame.

### Send, invoke and answers

| call | flag | meaning |
| --- | --- | --- |
| `com.send(msg)` | - | one way, nothing comes back |
| `com.invoke(msg)` | 4 | the peer is expected to answer |

Both return a `Message` immediately; `await messageObj.wait()` settles when it
finishes or fails, and the result is on `messageObj.data` / `messageObj.error`.

An answer is not a new conversation: the responder calls `messageObj.send(...)`
on the **incoming** message object, which allocates a fresh id from the
responder's own parity, sets the answer flag and puts the original id in
`answerFor`. That is why `messageObj.send` only exists on a message whose invoke
flag was set - answering a one-way send is not possible.

Incoming messages the peer started arrive at the handler registered with
`com.onIncoming(...)`: `handleAPI` on the server, `handleIncoming` on the
client. Both directions work - the server pushing to the client is what the
removed account and pairing features used - but the server sends nothing
unprompted today.

### Packets, acks and splitting

An `ArrayBuffer` larger than `packetSize` is cut into chunks, up to
`sendThreads` of them in flight at once. Every packet is acked; an unacked
packet is resent every `packetTimeout` until `packetRetry` runs out. A JSON
message is always a single packet but is acked the same way.

### Timeouts

Both sides are configured identically (`ws.js` `clientConnect`, `server.js`
`connect`):

| option | value | what it limits |
| --- | --- | --- |
| `interactTimeout` | 3000 ms | the gap between two packets of one message |
| `timeout` | 5000 ms | the whole message, end to end |
| `packetSize` | 1000 B | one binary chunk |
| `packetTimeout` | 1000 ms | wait for an ack before resending |
| `packetRetry` | `Infinity` | resend attempts per packet |
| `sendThreads` | 16 | packets in flight at once |

### Errors

`messageObj.error` is `""` on success, otherwise one of:

| value | when |
| --- | --- |
| `timeout` | the message did not finish inside `timeout` |
| `inactive` | no packet arrived for `interactTimeout` - **this is what an unanswered invoke looks like** |
| `abort` | this side called `abort()` |
| `reject` | the peer sent an abort flag |
| `send` | the `sender` function threw |
| `receive` | a packet ran out of retries |

## The application API

Everything above carries plain objects with a `"type"` key. `handleAPI` in
`ws.js` dispatches on it and every branch answers the caller.

| type | request | answer |
| --- | --- | --- |
| `conf-get` | - | `{"webrtc": {"iceServers": [...]}, "permissions": {"guestAllowShare": bool, "guestAllowJoin": bool}, "auth": {"google": {"clientId": string}}}` |
| `ping` | - | `{"success": true, "timestamp": number}` |
| `session-get` | - | `{"success": true, "sessionId": string}` |
| `version-check` | `{"version": string}` | `{"success": bool, "version": string}` |
| anything else | - | `{"success": false, "error": "unknown-type" \| "invalid-format"}` |

`conf-get` is built once in `ServerWS.start` by `buildPublicConf` and is the
**public half** of the configuration - ICE servers, the two guest permissions,
and the public client id of each configured sign-in provider. Never key
material, SMTP credentials, OAuth secrets or database settings. `auth` is absent
when no provider is configured, and so is anything the current config schema has
no field for (`serviceSharing`, which the client uses to decide whether to show
the services route - so that route stays hidden).

`sessionId` is the id of the **connection**, ten characters from
`generateId(10)`, unique among the live `clients` Map. It is not an account
session and does not survive a reconnect.

`version-check` compares against the `version` of `package.json`, cached by
`getVersion()`. `success: false` means the client is out of date, and the answer
carries the version it should be on.

### Static config over HTTP vs. the live version over WS

These are two different versions and they are allowed to disagree.

| | `config.json` over HTTP | `version-check` over WS |
| --- | --- | --- |
| what it is | the **static** config the client was shipped with | the **live** version of the process answering right now |
| written by | `buildConfFile` at compile, then `ServerHTTP.start` at boot | `getVersion()`, read from `package.json` |
| read as | `conf["http"]["version"]` | the `version` field of the answer |
| how stale it can get | as stale as the client build | never |

`config.json` is fetched once, at load, by `src/client/web/src/conf.js`. Nothing
refreshes it. So it goes stale in two ways:

- a **browser** tab left open across a server upgrade keeps the copy it loaded;
- a **desktop** client reads the copy bundled in its own zip under
  `resources/app`, which is as old as the installed client - arbitrarily far
  behind the server it is talking to.

The socket is the only thing that knows what the server actually is. Hence the
intended behaviour:

> After connecting, the client checks its own version against `version-check`.
> On a mismatch the UI points the user at the download page so they can get the
> new version.

**None of that is implemented.** Nothing in the client calls `version-check`
today, and `conf["http"]["version"]` is only ever printed in Settings → About
(`ui/settings/about/index.js`). The pieces that exist:

- the check would go in the `open` handler of `src/client/web/src/server.js`,
  right after `conf-get`, and would raise an event the shell listens for;
- the download page already exists as the `downloads` screen
  (`ui/downloads/`, route `downloads`), which builds the OS/architecture list
  from `conf["http"]["clients"]`.

Two things to settle before wiring it up:

1. **A stale browser tab does not need a download - it needs a reload.** The
   download page is the right answer for the desktop client
   (`desktop.isAvailable`); for the web client the same mismatch means the page
   itself is old, and reloading fetches a current `config.json` and a current
   build. The two cases probably want different UI.
2. **How stale the download list of a desktop client is.** The two generators
   write the same fields now - `buildConfFile` emits `clients` from the dists
   the compile found, so the download screen has a list on both clients:

   | key | web (`ServerHTTP.start`) | desktop zip (`buildConfFile`) |
   | --- | --- | --- |
   | `http.clients` | yes | yes |
   | `http.version` | yes | yes |
   | `http.domain`, `http.port` | no | yes |
   | `ws.domain`, `ws.port` | yes | yes |

   The desktop copy is as old as the installed client, so a target the server
   added since goes missing from it while a target it dropped is still offered.
   The list is exactly what `version-check` implies is stale, so it probably
   wants to come over the socket with the version answer rather than out of the
   bundled file.

### Answering, not aborting

An unknown or malformed call is **answered** with `{"success": false, ...}`.
This matters: `messageObj.abort()` on an *incoming* message only resolves the
local promise, it sends nothing to the peer, so aborting would leave the caller
waiting out its whole `interactTimeout` and failing with `inactive` three
seconds later. `handleAPI` funnels both cases through `reject()`, which answers
an invoke and only falls back to `abort()` for a one-way send.

## Gotchas

- **`wait()` never throws.** A failed call resolves like a successful one, with
  the reason in `messageObj.error` and `messageObj.data` left `undefined`.
  Wrapping it in `try`/`catch` catches nothing; check `error` instead.
- **Every call needs a failure branch.** Any type the server does not serve now
  answers `{"success": false}`, so `data["success"]` is safe to read - but a
  connection that dies mid-call still leaves `data` `undefined`.
- **The two `communicator.js` copies must stay in sync**, including the parts
  this document describes as layout. They are deliberately not an npm
  dependency; edit the copies in the repo and keep their SPDX headers.
- **Nothing serves `src/client/web` directly.** A change to the client is
  invisible until `npm run server -- --compile` rebuilds `tmp/web`.
- `ArrayBuffer.prototype.transfer` is used on every incoming binary frame,
  acks included, so it is on the hot path of every message. It is newer than the
  `"node": ">=20.11.0"` floor in `package.json` - worth verifying that floor
  before trusting it.

## Testing it by hand

There is no test harness for the socket. The quickest check is a small script
that drives the **browser's own** communicator against a running server, which
is what verified the table above:

```js
import Communicator from "<repo>/src/client/web/libs/communicator/communicator.js";
import WebSocket from "<repo>/node_modules/ws/index.js";

const com = new Communicator({
    "sender": async function(data) {
        ws.send((data instanceof ArrayBuffer) ? data : JSON.stringify(data));
    },
    "interactTimeout": 3000, "timeout": 5000, "packetSize": 1000,
    "packetTimeout": 1000, "packetRetry": Infinity, "sendThreads": 16
});
const ws = new WebSocket("wss://localhost:8444", {"rejectUnauthorized": false});
ws.binaryType = "arraybuffer";
ws.addEventListener("message", function(event) {
    let data = event.data;
    if (typeof data === "string") { data = JSON.parse(data); }
    else if (data instanceof Buffer) { data = new Uint8Array(data).buffer; }
    com.receive(data);
});
ws.addEventListener("open", async function() {
    await com.sideSync();
    await com.timeSync();
    const m = com.invoke({"type": "conf-get"});
    await m.wait();
    console.log(m.error, m.data);
});
```

`rejectUnauthorized: false` is needed for the self-signed certificate in
`conf/`. The same certificate is why a headless browser refuses the page with
`ERR_CERT_AUTHORITY_INVALID` - a real browser has to accept it once by hand.

## Not implemented yet

Sign-in and account sessions, user data subscriptions, pair codes, joins and the
WebRTC signaling relay were cut out of `ws.js` and are planned in
[../plans/](../plans/). The client's `Server` class was cut back to match, so
nothing in the browser sends a type the server does not answer: what is left of
it is the socket lifecycle and `conf-get`. The UI modules those methods fed -
the account windows, the pairing dialogs, the device and share lists - are still
there and still mount, on empty lists and dead buttons, each one pointing at the
plan that fills it again. The previous implementation is at commit `6c0d18a` on
the server side and `da3921d` on the client side; both were written against an
older config shape and should be read, not pasted back.
