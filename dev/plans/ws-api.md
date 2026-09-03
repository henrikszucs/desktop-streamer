# WS API inventory

Every call the WS server has to answer, what it takes and returns, which handler
group it belongs to under `src/server/ws/handlers/`, and which plan restores it.

The shapes below were read out of the removed implementation
(`git show 6c0d18a:src/server/ws.js`), not out of the plan files — where the two
disagree, the disagreements are listed at the bottom and the code is what is
recorded here.

**19 calls to implement, 4 answered today.** Nothing in the browser sends a type
the server does not answer, so none of this is broken right now; it is all
feature work that is missing on both ends.

## Answered today

| type | group file | request | answer |
| --- | --- | --- | --- |
| `conf-get` | `handlers/conf.js` | – | the public half of the configuration |
| `ping` | `handlers/connection.js` | – | `{"success": true, "timestamp"}` |
| `session-get` | `handlers/connection.js` | – | `{"success": true, "sessionId"}` |
| `version-check` | `handlers/connection.js` | `{"version"}` | `{"success", "version"}` |

`ping`, `session-get` and `version-check` are newer than the cut — they were
never in `6c0d18a`. Everything below was.

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

### Pairing → `handlers/pair.js`

Plan: [ws-pairing-joins.md](ws-pairing-joins.md). Depends on accounts.

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

### Joins → `handlers/join.js`

Plan: [ws-pairing-joins.md](ws-pairing-joins.md).

| type | request | answer |
| --- | --- | --- |
| `join-connect` | `{"joinId", "peerCode"\|"hostCode"}` | `{"success", "values": {"name", "isOnline", "isRemember"}}` |
| `join-disconnect` | `{"joinId", "peerCode"\|"hostCode"}` | `{"success"}` |
| `join-rename` | `{"joinId", "name", "peerCode"\|"hostCode"}` | `{"success"}` |
| `join-remember` | `{"joinId", "isRemember", "hostCode"}` | `{"success"}` |
| `join-rehost` | `{"joinId"}` | `{"success", "hostCode"}` |
| `join-delete` | `{"joinId", "peerCode"\|"hostCode"}` | `{"success"}` |

`peerCode` and `hostCode` are the two capabilities of a join — which one a socket
presents decides which side it is and what it may change. Each side names the
other independently, so `join-rename` writes only the caller's column; the
exception is a user paired with themselves, where both names move together.

### Signaling relay → `handlers/relay.js`

Plan: [ws-pairing-joins.md](ws-pairing-joins.md).

| type | request | answer |
| --- | --- | --- |
| `join` | `{"joinId"}` | a relay loop, not a single answer |

The one call that holds two messages open at once: it carries SDP and ICE
between the peer that asked and the first connected host socket, using the
communicator's invoke in both directions, until the peer sends `finish`. Every
branch that returns early has to send `{"finish": false}` to the other side or
it waits out the communicator timeout.

Worth its own file for that reason — it is the only handler that is a
conversation rather than a request and an answer.

## Server-initiated events

These are **not** in the request/answer table above, and `ws/api.js` has no place
for them: it dispatches what arrives, and nothing in `src/server/ws/` currently
sends a message a client did not ask for. Restoring accounts or pairing means
adding that direction — a `ws/events.js` beside `api.js`, or a method on
`ServerWS` the handlers call.

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

1. **An outbound direction.** See above.
2. **Per-connection state.** `clientConnect` puts `com` and `ws` in the client
   `Map`. Signed-in connections also need `isLoggedIn`, `userId` and the
   *account* `sessionId` — which is not the connection session id
   `generateSessionId()` produces. Keep the two apart.
3. **Server-level indexes.** `sessions`, `subscriptions`, `pairs`, `joins` and
   `joinsUser` maps on `ServerWS`. All in memory, which is what makes the WS
   server single-process — worth saying out loud before anything assumes
   otherwise.
4. **Shared guards.** Almost every removed branch opened with the same two
   checks: input types, then `if (client.get("isLoggedIn") !== true)`. That
   belongs in one place rather than copied into 19 handlers.
5. **A close handler that unwinds.** The current one releases the communicator
   and drops the client. It will also have to end the account session, drop every
   subscription, release the pair code, and remove the socket from every join it
   is in while notifying the other side.
6. **An answer convention.** `api.js` `reject` sends
   `{"success": false, "error": "unknown-type"}`, but every removed branch
   answered a bare `{"success": false}` with no reason. Pick one before writing
   19 handlers against the other.

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
browser side either, and `ui/room/index.js` is still an empty `Screen`. Restoring
those five server calls is not enough to make a room work.

One gap belongs to `conf-get` rather than to any of the above: the client hides
the `services` route unless the answer carries `serviceSharing`
(`src/client/web/src/router.js`, `ui/management/nav-left/index.js`,
`ui/management/menu/index.js`), and the current schema has no such field. That is
open work item 2 in [ws-client-config.md](ws-client-config.md).

## Suggested order

Unchanged from [README.md](README.md): client config → database → accounts →
pairing/joins. Within the last one, joins before the relay, and the relay last.
