# WS pairing, joins and WebRTC signaling

Restore the part of the protocol that actually connects two people: the pairing
codes that introduce a peer to a host, the joins that remember the pair, and the
signaling relay that carries the WebRTC offer, answer and candidates between
them.

Source of the removed code: `git show 6c0d18a:src/server/ws.js` -
`addPairCode` 585-604, `removePairCode` 605-658, `broadcastJoin` 659-711,
`addJoin` 712-790, `updateJoin` 791-1028, `addJoinMemory` 1029-1065,
`removeJoin` 1066-1102, `addClientJoin` 1103-1153, `removeClientJoin` 1154-1227,
and the `handleAPI` branches listed below.

Depends on [ws-accounts.md](ws-accounts.md) - a join is keyed by user id, and
remembering one needs the `joins` table.

## State

```
pairs     = Map<pairCode, {hostSessionId, peerSessionId, answerTimeoutId}>
joins     = Map<joinId, {peerCode, hostCode, peerUserId, hostUserId,
                         peerName, hostName, isRemember,
                         peerClientIds: Set, hostClientIds: Set}>
joinsUser = Map<userId, Set<joinId>>      // index for the "devices"/"shares" lists
```

`joins` holds every join with at least one connected socket. A remembered join
also has a `joins` row and is loaded back from it on demand; a guest join lives
only in memory and only while somebody holds it. `joinsUser` exists so a signed-in
user's device list can be found without walking every join.

## Pairing

A host asks for a code, a peer sends the code back, the host accepts or rejects,
and both ends come out of it holding a join.

| type | request | answer |
| --- | --- | --- |
| `pair-create` | - | `{"success", "pairCode", "timeout"}` **(done)** |
| `pair-request` | `{"pairCode"}` | `{"success", "timeout", "error"}` **(done)** |
| `pair-accept` | `{"remember"}` | `{"success", "error"}` **(done, minus `remember`)** |
| `pair-reject` | - | `{"success"}` **(done, from either side)** |
| `pair-delete` | - | `{"success"}` **(done)** |

Server-initiated on the host socket:

```
{"timestamp", "type": "pair-request",
 "details": {"ipAddress", "isUser", "firstName"?, "lastName"?}, "timeout": number}
{"timestamp", "type": "pair-reject"}
{"timestamp", "type": "pair-accept", "joinCode": string}
```

A pair code was short-lived and single-use: `addPairCode` stored a timeout id
alongside it, and `removePairCode` cleared the timeout and notified whichever
side did not ask for the removal. Every exit path - accept, reject, delete,
timeout, socket close - has to go through it or the code leaks.

`src/server/ws/handlers/pairing.js` holds all of this now, gated on
`guestAllowShare` and `guestAllowJoin` (every client is a guest until
[ws-accounts.md](ws-accounts.md)), with the `pairs` Map on `ServerWS` and every
exit going back through `removePairCode`/`releasePeer` - the delete call, either
answer, the answer timeout, and either socket closing (`ws.js`
calls `removePairCode` from its close handler and `releasePairCodes` from
`stop()`, so no timeout outlives the server).

Differences from the code that was removed, all deliberate:

- A code has **no expiry**: the share dialog is what holds it open, so it stands
  while the host is offering it, and a refusal is what replaces one. The window
  to answer a request in is the only clock left.
- The host is **told** about a request rather than asked: the push is not
  awaited before the peer is answered, because a sharing host is a tab somebody
  switched away from and a throttled acknowledgment must not hold the peer up.
  A push that fails to arrive within the answer window ends the request.
- A refused code is **replaced** (`renewHostCode`) and the host is told the new
  one on a `pair-code` push, so a number somebody just tried is worth nothing to
  them a second time. A peer that only gives up leaves the code alone.
- The withdrawal of a request has its own push (`pair-cancel`) rather than
  reusing `pair-reject` towards the host, so each side gets the word for what
  happened to it.
- `remember` is not read: it belongs to the join that remembers a pair, which is
  what is left below. An accepted request today ends with both sides told and the
  code used up, and carries no `joinId`.

## Joins

| type | request | answer |
| --- | --- | --- |
| `join-connect` | `{"joinCode"}` | `{"success", "joinId", "isHost", "isUnsupervised", "name", "isOnline"}` **(done)** |
| `join-list` | - | `{"success", "joins"}` **(done, not in the original)** |
| `join-request` | `{"joinId"}` | `{"success", "isAccepted", "timeout"}` **(done, not in the original)** |
| `join-accept` / `join-reject` | `{"joinId"}` | `{"success"}` **(done)** |
| `join-delete` | `{"joinId"}` | `{"success"}` **(done)** |
| `join-disconnect` | `{"joinId", ...}` | `{"success"}` |
| `join` | `{"joinId"}` | signaling, below |
| `join-rename` | `{"joinId", "name"}` | `{"success", "name"}` **(done, one code)** |
| `join-remember` | `{"joinId", "remember", ...}` | `{"success"}` |
| `join-rehost` | `{"joinId", ...}` | `{"success", "hostCode"}` |

`src/server/ws/handlers/joins.js` holds the done half. It departs from the shape
above in three places, all deliberate:

- **A join is asked for, not just connected to.** `join-connect` only makes a
  device reachable; `join-request` is the accept-or-reject that follows, and it
  is the same conversation as the pairing one because it is the same dialog on
  both sides. `is_unsupervised` on the row is what lets the server answer it
  itself, which is the whole point of the second checkbox on the host.
- **One code, not a join id and a code.** Which of the two a socket presents is
  what decides its side, so the id adds nothing to the lookup.
- **`join-list` is new**, because the two screens need who is online and nothing
  else does. The `broadcastJoin` fan-out below is not built - it collects sockets
  from subscriptions that do not exist yet - and every push this group sends goes
  to the sockets of one join instead:

```
{"timestamp", "type": "join-request", "joinId": string, "details": {...}, "timeout": number}
{"timestamp", "type": "join-accept", "joinId": string}
{"timestamp", "type": "join-reject", "joinId": string, "reason": "rejected"|"timeout"|"gone"|"removed"}
{"timestamp", "type": "join-cancel", "joinId": string, "reason": "cancelled"|"timeout"|"gone"|"removed"}
{"timestamp", "type": "join-online", "joinId": string, "isOnline": boolean}
{"timestamp", "type": "join-remove", "joinId": string}
```

  **`join-online` is presence, and only its edges.** The first socket of a side
  arriving and the last one leaving are pushed to the other side; a second window
  of a device that is already there changes nothing and sends nothing. It is a
  push rather than a poll because the badge that draws it is on the bars, not on
  a screen somebody opened - `join-list` answers the same question once, for a
  screen that has just been opened.

`is_remember` is still not a column - a row existing is the remembered flag - and
`remember`/`unsupervised` reach the server as the two flags on `pair-accept`.

`peerCode` and `hostCode` are the two capabilities of a join - which one a socket
presents decides which side it is and what it may change. They are ten characters
and must differ from each other; `addJoin` regenerated until they did.

Each side names the other independently: `peer_name` and `host_name` are
separate columns, and `join-rename` writes only the caller's - the host names the
peer, the peer names the host, which is the same column `join-connect` reads the
name back from. **Nothing is pushed**: the other side is not affected by what
this one calls it. The name is capped at `JOIN_NAME_MAX` (64), the length of the
input that writes it. The exception the old code carried - a user paired with
themselves (`peerUserId === hostUserId`), where both names moved together - waits
for accounts, since there are no user ids to compare yet.

The name is on the row rather than only in the client so a device presenting the
same code again is handed it back. The client keeps its own copy for the screens
it draws offline and adopts the row's when `join-connect` answers a non-empty one
(`connectAll` in `src/client/web/src/joins.js`); an empty one is a row nobody has
named, not a name somebody cleared.

Every change fans out through `broadcastJoin(joinId, msg, containDevices,
containShares, containPeers, containHost, callerClientId)`, which collects the
sockets to notify from four sources - the `devices` subscribers of the peer user,
the `shares` subscribers of the host user, the connected peer sockets and the
connected host sockets - into a set, so a socket that is in two of them is
notified once. The caller is excluded; it already has its answer.

```
{"timestamp", "type": "devices" | "shares",
 "isChange": boolean, "isRemove": boolean, "value": {...}}
```

`addJoin` also named the room `generateId(3, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") +
getText("room", lang)`. **`getText` was never imported** - see the same note in
[ws-accounts.md](ws-accounts.md).

## Signaling relay **(done, in a different shape)**

`src/server/ws/handlers/rooms.js` holds it, and it is **not** the held-open loop
below. What landed:

| type | request | answer |
| --- | --- | --- |
| `room-signal` | `{"roomKey", "signal"}` | `{"success", "error"}` |
| `room-data` | `{"roomKey", "data"}` | `{"success", "error"}` |
| `room-leave` | `{"roomKey"}` | `{"success"}` |

Server-initiated, on both sockets:

```
{"timestamp", "type": "room-open", "roomKey": string, "joinId": string, "isHost": boolean}
{"timestamp", "type": "room-signal", "roomKey": string, "signal": object}
{"timestamp", "type": "room-data", "roomKey": string, "data": any}
{"timestamp", "type": "room-close", "roomKey": string, "reason": "left"|"gone"}
```

Differences from the plan below, all deliberate:

- **A room, not a `join` branch.** A pairing that was not remembered leaves no
  join behind, so a relay keyed on one could not carry the connection it just
  made. `rooms` is `Map<roomKey, {hostKey, peerKey, hostSessionId, peerSessionId, joinId}>`
  - one room under both of its keys, each side told only its own - made by
  `pair-accept`, by `join-accept` and by the unsupervised `join-request`, and it
  dies with either socket: there is nothing in a half-negotiated connection worth
  keeping.
- **One message per call, not a loop.** The note at the bottom of this file asks
  for the loop to be bounded; a per-message relay has nothing to bound. The
  server holds no state between two signals and a slow client holds nothing open.
- **Both sides are told, rather than the answer carrying it.** The host of an
  unsupervised join is never asked anything, so there is no answer to put a room
  id in - `room-open` is the one path, and it also says which side each socket
  is, which is what decides who offers (the peer does).
- **The signal is opaque but the envelope is not**: an object, at most 16 KB, to
  one other socket. The server never parses SDP.
- **The relay permission is cached on the connection.** `clientConnect` answers
  it once (`isRelayAllowed` in the client state) and the relay reads it from
  there for every message it carries. It is deliberately not re-read: a
  permission is not expected to change under a live socket, and the relay is the
  one call in this protocol that runs per message rather than per flow. When
  `ws-accounts.md` lands, sign-in fills that slot from the user's row - one read
  for the session, not one per message.
- **`guestAllowRelay` gates the relayed payload, in both of its forms** - the
  `room-data` call and the binary frame, which is the one a client actually
  streams over. The schema calls it *use server
  for media data transfer*, which is what the fallback is: two devices that
  cannot reach each other, and the server carrying what would have gone between
  them. The negotiation every connection needs (`room-signal`) is never gated -
  on a flag that defaults to `false`, that would mean no guest could ever
  connect. The flag is also answered to the client in `permissions`, because a
  fallback that is not there must not be waited for.
- **The fallback is this server, not a TURN server.** That is the decision, not
  a step towards one: `room-data` is `room-signal` with a different cap (64 KB)
  and a permission in front of it, and the client takes it after
  `DIRECT_TIMEOUT` or an ICE failure. The `iceServers` in the configuration are
  STUN - they help the two ends *find* each other - and nothing in this project
  asks for a TURN credential, which is why the schema takes URL strings and no
  username or password. What is relayed goes over the socket both ends already
  hold, so it needs no second address, no second port and no second thing to run.
- **It carries bytes, and there is no size to stay under.** The communicator
  splits an ArrayBuffer into packets and reassembles it at the far end, and does
  none of that for JSON - so a binary frame (`[kind][room key][payload]`) is the
  relay's own path and `room-data` is left as the small answered one. 16 MB
  crosses it intact in about 600 ms through the real stack
  (`tests/relay.test.js`), and the direct leg carries the same sizes because its
  data channel is wrapped in a `Communicator` too. What the media work still
  owns: a sequence of some kind, since frames of very different sizes can finish
  out of order on either leg.

The client half is `src/client/web/src/room.js` (`ctx["room"]`): one
`RTCPeerConnection`, one `control` data channel, and `connecting`/`connected`/
`closed` events. It carries **no media** - the open channel is what says the two
ends can reach each other, and the room screen lifts its own wait on it.

What was planned instead, kept for the record:

The `join` branch is the one that matters and the one to get right. The server
never sees media; it carries SDP and ICE between the peer that asked and the
first connected host socket, using the communicator's invoke both ways:

```
 Client1                     Server                      Client2
    |          {joinId}         |          {joinId}         |
    |-------------------------->|-------------------------->|
    |     {success,accepted}    |         {success}         |
    |<--------------------------|<--------------------------|
    |          {webrtc}         |          {webrtc}         |
    |-------------------------->|-------------------------->|
    |          ........         |          ........         |
    |<--------------------------|<--------------------------|
    |          {finish}         |          {finish}         |
    |<--------------------------|<--------------------------|
    |-------------------------->|                           |
```

The relay loop runs until the peer sends `finish`, and every branch that returns
early has to send a `{"finish": false}` to the other side or it waits out the
communicator timeout.

## Work

1. Restore `joinsUser` (`pairs` and `joins` are live) when accounts land - the
   device list of a signed-in user cannot be found by walking sockets.
2. ~~Give `pair-accept` the join it should make~~ - done, with `unsupervised`
   beside `remember`. ~~What is missing from it is the naming~~ - `join-rename`
   is done too. `pair-accept` still writes both name columns empty, so a
   connection nobody has named falls back to a localized label on both screens.
3. Restore the join branches and `broadcastJoin`.
4. ~~Restore the `join` signaling relay last; it is the only branch that holds
   two messages open at once.~~ - done as `handlers/rooms.js`, which holds none.
   The data relay beside it (`room-data`) is the fallback for two devices that
   cannot reach each other, end to end in `tests/relay.test.js`.
5. ~~Extend the socket close handler to drop the socket from every join it is in
   and notify the other side~~ - done, and the rooms with it (`detachRooms`).

## Notes

- Nothing in the removed code checked the guest permissions (`guestAllowShare`,
  `guestAllowJoin`) that `config.js` already validates. The pairing calls check
  both today; wire `guestAllowRelay` in while restoring rather than after.
- The relay is a per-message `while` loop with `await` on both sides. One slow or
  hostile client holds a server-side loop open for as long as the communicator
  timeouts allow; bound it.
