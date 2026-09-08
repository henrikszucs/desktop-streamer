# WS API inventory

Every call the WS server has to answer, what it takes and returns, which handler
group it belongs to under `src/server/ws/handlers/`, and which plan restores it.

The shapes below were read out of the removed implementation
(`git show 6c0d18a:src/server/ws.js`), not out of the plan files — where the two
disagree, the disagreements are listed at the bottom and the code is what is
recorded here.

**10 of the original 19 are still to implement**, all of them accounts, user
data, or the three join calls that wait on one. The pairing, the joins a device
comes back on and the relay are answered today, several of them in a shape the
tables below do not describe — where that is so, the section says which.

## Answered today

| type | group file | request | answer |
| --- | --- | --- | --- |
| `conf-get` | `handlers/conf.js` | – | the public half of the configuration, the server version included |
| `ping` | `handlers/connection.js` | – | `{"success": true, "timestamp"}` |
| `session-get` | `handlers/connection.js` | – | `{"success": true, "sessionId"}` |
| `pair-create` / `pair-delete` | `handlers/pairing.js` | – | the six digit code a host offers, and giving it up |
| `pair-request` / `pair-accept` / `pair-reject` | `handlers/pairing.js` | `{"pairCode"}` / `{"remember", "unsupervised"}` / – | the one join attempt a code carries |
| `join-connect` / `join-list` | `handlers/joins.js` | `{"joinCode"}` / – | be reachable on a code; who is online |
| `join-rename` | `handlers/joins.js` | `{"joinId", "name"}` | `{"success", "name"}` |
| `join-request` / `join-accept` / `join-reject` | `handlers/joins.js` | `{"joinId"}` | the same accept-or-reject, on a pairing already made |
| `join-delete` | `handlers/joins.js` | `{"joinId"}` | `{"success"}` |
| `room-signal` / `room-data` / `room-leave` | `handlers/rooms.js` | `{"roomId", …}` | the relay, one message per call |
| a **binary** message | `handlers/rooms.js` | `[kind][roomId][payload]` | forwarded, unanswered |

`ping`, `session-get`, `join-list`, `join-request`/`join-accept`/`join-reject`
and the three `room-*` calls are newer than the cut — they were never in
`6c0d18a`. Everything below was.

## To implement

### Accounts and sign-in → `handlers/auth.js`

Plan: [ws-accounts.md](ws-accounts.md). Depends on [ws-database.md](ws-database.md)
and [ws-client-config.md](ws-client-config.md).

| type | request | answer |
| --- | --- | --- |
| `login-google` | `{"credential", "userAgent"}` | `{"success", "sessionId", "sessionKey"}` |
| `login-session` | `{"sessionKey"}` | `{"success"}` |
| `logout` | `{"sessionId"}` | `{"success"}` |

`login-google` verifies the credential against
`https://oauth2.googleapis.com/tokeninfo?id_token=…` and checks three things
before trusting it: `aud` equals the configured client id, `email_verified` is
`"true"`, `exp` is in the future. It creates the user row on first sign-in, which
is where the `userRegister` permission has to be enforced — the schema has the
field and nothing reads it.

### User data and account deletion → `handlers/user.js`

Plan: [ws-accounts.md](ws-accounts.md).

| type | request | answer |
| --- | --- | --- |
| `user-data-subscribe` | `{"key", "once", …params}` | `{"success", "value"}` |
| `user-data-unsubscribe` | `{"key"}` | `{"success"}` |
| `delete-email` | `{"lang"}` | `{"success"}` |
| `delete` | `{"deleteKey"}` | `{"success"}` |

`key` is one of `email`, `firstName`, `lastName`, `picture`, `sessions`,
`devices`, `shares`. `once` asks for the current value without subscribing.
`picture` is fetched with `httpsGetImage` and sent as data, never as a Google URL.

### Pairing → `handlers/pairing.js` **(done)**

Plan: [ws-pairing-joins.md](ws-pairing-joins.md). The shapes below are the
removed code's; what landed differs and is written out in the plan.

| type | request | answer |
| --- | --- | --- |
| `pair-create` | – | `{"success", "pairCode"}` |
| `pair-request` | `{"pairCode"}` | `{"success", "isBusy", "timeout", "details"}` |
| `pair-accept` | `{"isRemember", "lang"}` | `{"success", "joinCode"}` |
| `pair-reject` | – | `{"success"}` |
| `pair-delete` | – | `{"success"}` |

`details` is `{"ipAddress", "isUser", "firstName"?, "lastName"?}`. `lang` on
`pair-accept` only picks the default room name. A pair code is short-lived and
single-use: every exit path — accept, reject, delete, timeout, socket close —
has to go through `removePairCode` or the code leaks.

### Joins → `handlers/joins.js` **(half done)**

Plan: [ws-pairing-joins.md](ws-pairing-joins.md).

| type | request | answer |
| --- | --- | --- |
| `join-connect` | `{"joinId", "peerCode"\|"hostCode"}` | `{"success", "values": {"name", "isOnline", "isRemember"}}` **(done, one code and no `values`)** |
| `join-rename` | `{"joinId", "name", "peerCode"\|"hostCode"}` | `{"success"}` **(done, one code, and the name is answered back)** |
| `join-delete` | `{"joinId", "peerCode"\|"hostCode"}` | `{"success"}` **(done, one code)** |
| `join-disconnect` | `{"joinId", "peerCode"\|"hostCode"}` | `{"success"}` |
| `join-remember` | `{"joinId", "isRemember", "hostCode"}` | `{"success"}` |
| `join-rehost` | `{"joinId"}` | `{"success", "hostCode"}` |

`peerCode` and `hostCode` are the two capabilities of a join — which one a socket
presents decides which side it is and what it may change. **The three that landed
take the code alone**: which of the two a socket presented at `join-connect` is
what decides its side, so the id adds nothing to the lookup. Each side names the
other independently, so `join-rename` writes only the caller's column
(`peer_name` for a host, `host_name` for a peer — the same one `join-connect`
reads back, and nothing is pushed to the other side); the exception is a user
paired with themselves, where both names move together, and that waits for
accounts to have user ids to compare.

### Signaling relay → `handlers/rooms.js` **(done, in a different shape)**

Plan: [ws-pairing-joins.md](ws-pairing-joins.md).

The removed code had one call, `join` `{"joinId"}`, and it was a relay *loop*
rather than a single answer: it held two messages open at once and carried SDP
and ICE between the two sockets until the peer sent `finish`, so every branch
that returned early had to send `{"finish": false}` or the other side waited out
the communicator timeout.

**That is not what landed.** `handlers/rooms.js` is one message per call —
`room-signal`, `room-data`, `room-leave`, and a binary frame that is not a call
at all — so the server holds nothing between two signals and there is no
held-open conversation to bound. What ties the two sockets together is a room
rather than a join, because a pairing that was not remembered leaves no join
behind to key one on. The differences are written out in
[ws-pairing-joins.md](ws-pairing-joins.md).

## Server-initiated events

These are **not** in the request/answer table above, and `ws/api.js` has no place
for them: it dispatches what arrives. **That direction exists now** — it is
`ws/notify.js` (`push`, `notify`, `notifyAll`, `pushData`), which the pairing,
join and room groups all send through. What is left below is the account half.

The pushes that landed are written out in
[ws-pairing-joins.md](ws-pairing-joins.md): five for pairing, six for joins
(`join-online` among them, which is presence and pushed only on its edges) and
four for rooms.

From the account work:

```
{"timestamp", "type": "logout" | "email" | "firstName" | "lastName" | "picture"
                    | "sessions" | "devices" | "shares",
 "isChange": boolean, "isRemove": boolean, "value": any}
```

From the pairing work, on the host socket:

```
{"timestamp", "type": "pair-request", "details": {…}, "timeout": number}
{"timestamp", "type": "pair-reject"}
{"timestamp", "type": "pair-accept", "joinCode": string}
```

Join changes fan out through `broadcastJoin`, which collects sockets from four
sources — the `devices` subscribers of the peer user, the `shares` subscribers of
the host user, the connected peer sockets, the connected host sockets — into one
set so a socket in two of them is notified once, and excludes the caller.

## What this needs that the current `ws/` folder does not have

1. ~~**An outbound direction.**~~ `ws/notify.js`. See above.
2. **Per-connection state.** `clientConnect` puts `com` and `ws` in the client
   `Map`. Signed-in connections also need `isLoggedIn`, `userId` and the
   *account* `sessionId` — which is not the connection session id
   `generateSessionId()` produces. Keep the two apart.
3. **Server-level indexes.** `pairs`, `joins` and `rooms` are on `ServerWS`
   already; `sessions`, `subscriptions` and `joinsUser` come with accounts. All
   in memory, which is what makes the WS server single-process — worth saying
   out loud before anything assumes otherwise.
4. **Shared guards.** Almost every removed branch opened with the same two
   checks: input types, then `if (client.get("isLoggedIn") !== true)`. That
   belongs in one place rather than copied into 19 handlers.
5. **A close handler that unwinds.** It releases the communicator, drops the
   client, releases the pair code (`releasePeer`), leaves every join
   (`detachJoins`) and every room (`detachRooms`), telling the other side of
   each. What is left for accounts: ending the account session and dropping
   every subscription.
6. ~~**An answer convention.**~~ Settled: `{"success": false, "error": <name>}`,
   the shape `api.js` `reject` already used. Every handler written since answers
   a reason rather than the bare `{"success": false}` the removed branches
   sent.

## Where the plans and the removed code disagree

The plan tables were written from memory of the code and are wrong in five
places. The code is what is recorded above.

| call | the plan says | the code does |
| --- | --- | --- |
| `pair-request` | answer `{"success", …}` | `{"success", "isBusy", "timeout", "details"}` |
| `pair-accept` | request `{"remember"}` | `{"isRemember", "lang"}` |
| `join-connect` | answer `{"success", "name", "isRemember", "isOnline"}` | the three are nested under `"values"` |
| `join-remember` | request `{"joinId", "remember", …}` | `{"joinId", "isRemember", "hostCode"}` |
| `login-google` | request `{"credential", "userAgent"}` | its own doc block lists only `credential`, the code reads both — the plan is right, the old comment was stale |

Also worth knowing before restoring:

- **`join-delete` validates a field it does not take.** It reads
  `message["name"]` and rejects when it is not a string, which looks like a
  copy-paste from `join-rename`; the request doc block lists no `name`. As
  written, a correct `join-delete` request is always refused.
- **`getText` was never imported.** Account deletion and the default room name
  both call it; `src/server/localization.js` exports `get`. Both flows would have
  thrown. (Already noted in both plans.)
- **The account session was refreshed on every message** from a signed-in
  connection — one database write per message. Consider an interval.

## Client side

The old client (`da3921d`) only ever called 15 of the 20 types. It never
implemented `join` (the relay), `join-rename`, `join-remember`, `join-rehost` or
`join-delete` — so the room and the WebRTC half were never finished on the
browser side either. **Three of those five are answered now**, and the browser
half is written against them: `src/client/web/src/room.js` is the connection,
`ui/room/index.js` the screen over it, and `join-rename` reaches the server from
the connection dialog. `join-remember` and `join-rehost` are still on neither
side.

One gap belongs to `conf-get` rather than to any of the above: the client hides
the `services` route unless the answer carries `serviceSharing`
(`src/client/web/src/router.js`, `ui/management/nav-left/index.js`,
`ui/management/menu/index.js`), and the current schema has no such field. That is
open work item 2 in [ws-client-config.md](ws-client-config.md).

## Suggested order

From [README.md](README.md): client config → database → accounts →
pairing/joins. **The last one went first** — pairing, then joins, then the relay
— because none of it needed an account to work: the join code is the credential
until one exists. What is left is the account half, and the three join calls
(`join-disconnect`, `join-remember`, `join-rehost`) worth doing beside it.
