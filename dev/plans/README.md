# Plans

Work that is designed but not implemented yet. One file per unit of work, each
one written so it can be picked up on its own.

## WS server

Most of what is here was cut out of `src/server/ws.js` when the WS server was
wired into `src/server/server.js`. That file was reduced to the parts that make
a connection usable at all - the socket lifecycle, the session id of a
connection, the connection test and the version check - so the server can boot
end to end. Everything else was removed rather than left half-wired.

**The removed code is not lost.** It lives in git at commit `6c0d18a`, and every
WS plan below names the line range it came from:

```
git show 6c0d18a:src/server/ws.js
```

Treat that code as a reference, not as something to paste back. It was written
against an older configuration shape and never ran against the current schema
(see `ws-client-config.md`), so parts of it are known broken.

### What `ws.js` answers today

| type | request | answer |
| --- | --- | --- |
| `conf-get` | - | the public half of the configuration |
| `ping` | - | `{"success": true, "timestamp": number}` |
| `session-get` | - | `{"success": true, "sessionId": string}` |
| `version-check` | `{"version": string}` | `{"success": boolean, "version": string}` |

Anything else is logged and answered `{"success": false, "error": "unknown-type"}`.
It is *answered* rather than aborted on purpose - see
[../docs/websocket.md](../docs/websocket.md), which describes the whole client/server
protocol from the socket up to these types.

### WS plans

| plan | what it restores | depends on |
| --- | --- | --- |
| [ws-client-config.md](ws-client-config.md) | `conf-get` and the config shape the whole WS server reads | - |
| [ws-database.md](ws-database.md) | knex connection and the schema created on first boot | - |
| [ws-accounts.md](ws-accounts.md) | e-mail, Google sign-in, persistent sessions, user data | database, client config |
| [ws-pairing-joins.md](ws-pairing-joins.md) | pair codes, joins and the WebRTC signaling relay | accounts |

Suggested order: client config, database, accounts, pairing/joins. The
configuration shape has to be settled first because every later plan reads from
it, and nothing else can be tested while the server refuses to start.

## Client

| plan | what it changes | depends on |
| --- | --- | --- |
| [client-ui-modules.md](client-ui-modules.md) | splits the 3805-line `src/client/web/src/index.js` into modules that load when the UI needs them | - |

Independent of the WS plans, and staged in four phases so it can be done a piece
at a time. Phase 3 wants the SPA fallback in `src/server/http.js` narrowed first,
which is described in that plan.
