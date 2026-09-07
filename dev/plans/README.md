# Plans

Work that is designed but not implemented yet. One file per unit of work, each
one written so it can be picked up on its own.

## WS server

Everything here was cut out of the WS server (a single `src/server/ws.js` at the
time, `src/server/ws/` today) when it was wired into `src/server/server.js`.
That file was reduced to the parts that make a connection usable at all - the
socket lifecycle, the session id of a connection, the connection test and the
version check - so the server could boot end to end, and everything else was
removed rather than left half-wired. The config call, the database and the
pairing and join flows have since been written back; what is left is below.

**The removed code is not lost.** It lives in git at commit `6c0d18a`, and every
WS plan below names the line range it came from:

```
git show 6c0d18a:src/server/ws.js
```

Treat that code as a reference, not as something to paste back. It was written
against an older configuration shape and never ran against the current schema
(see `ws-client-config.md`), so parts of it are known broken.

### What the WS server answers today

| group | types |
| --- | --- |
| `handlers/conf.js` | `conf-get` |
| `handlers/connection.js` | `ping`, `session-get` |
| `handlers/pairing.js` | `pair-create`, `pair-delete`, `pair-request`, `pair-accept`, `pair-reject` |
| `handlers/joins.js` | `join-connect`, `join-list`, `join-request`, `join-accept`, `join-reject`, `join-delete` |

Each is one function in a group file under `src/server/ws/handlers/`, reached
through the dispatch table in `src/server/ws/api.js` - a new call is a function
in the group it belongs to, not another branch in one growing file.

Anything else is logged and answered `{"success": false, "error": "unknown-type"}`.
It is *answered* rather than aborted on purpose - see
[../docs/websocket.md](../docs/websocket.md), which describes the whole client/server
protocol from the socket up to these types.

### WS plans

[ws-api.md](ws-api.md) is the inventory across all of them: every call still to
be written, its request and answer as the removed code actually had them, and the
handler group it belongs to. Read it before picking up any plan below - it also
lists where these plan files disagree with that code.

| plan | what it restores | state |
| --- | --- | --- |
| [ws-client-config.md](ws-client-config.md) | `conf-get` and the config shape the whole WS server reads | the call is done; the shape questions in it are open |
| [ws-database.md](ws-database.md) | knex connection and the schema created on first boot | the connection and the `joins` table are done; the accounts tables are not |
| [ws-pairing-joins.md](ws-pairing-joins.md) | pair codes, joins and the WebRTC signaling relay | pairing and joins are done; the signaling relay is not |
| [ws-accounts.md](ws-accounts.md) | e-mail, Google sign-in, persistent sessions, user data | open, and what the three above are still waiting on |

What is left is one order: accounts, then the relay. Everything a connection can
ask about *itself* or about the two devices at either end of a pairing is
answered; nothing that needs a user behind it is, and nothing carries media yet.

## Client

[client-ui-modules.md](client-ui-modules.md) is done - kept as a record of what
the restructuring landed as and what it planned and dropped, not as work.
