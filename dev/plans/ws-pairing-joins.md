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
pairs     = Map<pairCode, {hostClientId, peerClientId, timeoutId}>
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
| `pair-create` | - | `{"success", "pairCode"}` |
| `pair-request` | `{"pairCode"}` | `{"success", ...}` |
| `pair-accept` | `{"remember"}` | `{"success", ...}` |
| `pair-reject` | - | `{"success"}` |
| `pair-delete` | - | `{"success"}` |

Server-initiated on the host socket:

```
{"timestamp", "type": "pair-request",
 "details": {"ipAddress", "isUser", "firstName"?, "lastName"?}, "timeout": number}
{"timestamp", "type": "pair-reject"}
{"timestamp", "type": "pair-accept", "joinCode": string}
```

A pair code is short-lived and single-use: `addPairCode` stored a timeout id
alongside it, and `removePairCode` cleared the timeout and notified whichever
side did not ask for the removal. Every exit path - accept, reject, delete,
timeout, socket close - has to go through it or the code leaks.

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

1. Restore the three maps and the join bookkeeping helpers.
2. Restore the pairing branches, with the timeout and the cleanup on socket close.
3. Restore the join branches and `broadcastJoin`.
4. Restore the `join` signaling relay last; it is the only branch that holds two
   messages open at once.
5. Extend the socket close handler to drop the socket from every join it is in
   and notify the other side, and to release its pair code.

## Notes

- Nothing here checks the guest permissions (`guestAllowShare`, `guestAllowJoin`)
  that `config.js` already validates. Wire them in while restoring rather than
  after.
- The relay is a per-message `while` loop with `await` on both sides. One slow or
  hostile client holds a server-side loop open for as long as the communicator
  timeouts allow; bound it.
