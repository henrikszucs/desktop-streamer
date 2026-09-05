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
| `join-connect` | `{"joinId", "peerCode"\|"hostCode"}` | `{"success", "name", "isRemember", "isOnline"}` |
| `join-disconnect` | `{"joinId", ...}` | `{"success"}` |
| `join` | `{"joinId"}` | signaling, below |
| `join-rename` | `{"joinId", "name", "peerCode"\|"hostCode"}` | `{"success"}` |
| `join-remember` | `{"joinId", "remember", ...}` | `{"success"}` |
| `join-rehost` | `{"joinId", ...}` | `{"success", "hostCode"}` |
| `join-delete` | `{"joinId", ...}` | `{"success"}` |

`peerCode` and `hostCode` are the two capabilities of a join - which one a socket
presents decides which side it is and what it may change. They are ten characters
and must differ from each other; `addJoin` regenerated until they did.

Each side names the other independently: `peerName` and `hostName` are separate
columns, and `join-rename` writes only the caller's. The exception is a user
paired with themselves (`peerUserId === hostUserId`), where both names move
together - `updateJoin` carries that case throughout.

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

## Signaling relay

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

1. Restore the two remaining maps (`pairs` is live) and the join bookkeeping
   helpers.
2. Give `pair-accept` the join it should make: the `remember` flag, the join id
   and codes, and the `joinId` both sides need in the answer and the push.
3. Restore the join branches and `broadcastJoin`.
4. Restore the `join` signaling relay last; it is the only branch that holds two
   messages open at once.
5. Extend the socket close handler to drop the socket from every join it is in
   and notify the other side (releasing its pair code is already there).

## Notes

- Nothing in the removed code checked the guest permissions (`guestAllowShare`,
  `guestAllowJoin`) that `config.js` already validates. The pairing calls check
  both today; wire `guestAllowRelay` in while restoring rather than after.
- The relay is a per-message `while` loop with `await` on both sides. One slow or
  hostile client holds a server-side loop open for as long as the communicator
  timeouts allow; bound it.
