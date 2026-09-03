# WS client configuration (`conf-get`)

Restore the message that hands the browser client the public half of the server
configuration, and settle the configuration shape the WS server reads.

Source of the removed code: `git show 6c0d18a:src/server/ws.js`, lines 180-326
(`start`) and 1304-1309 (the `conf-get` branch).

## Status: partly done

**Work item 3 is done.** `ServerWS.buildPublicConf` and the `conf-get` branch
exist, built only from fields the current schema already accepts, so the client
connects and goes online without any config change. See
[../docs/websocket.md](../docs/websocket.md) for the answer it sends.

**Work items 1 and 2 are open** - the shape questions below were not settled,
they were side-stepped. `serviceSharing` is still absent from the answer, so the
services route stays hidden, and `guestAllowRelay` / `userRegister` /
`userRegisterRelay` are still read by nothing - `userRegister` waits on the
sign-in work in [ws-accounts.md](ws-accounts.md), which is where it is enforced.

## Why this comes first

The removed `start()` read fields that the current schema does not accept. The
Ajv schema in `src/server/config.js` sets `"additionalProperties": false` on the
`ws` section, so a config with the fields the old code wanted is rejected, and a
config the schema accepts makes the old code throw on an undefined property.

| the old `ws.js` read | `config.js` defines today |
| --- | --- |
| `ws.emails` - an array of SMTP servers, iterated | `ws.email` - a single SMTP object, optional |
| `ws.features.auth.google` | `ws.auth.google` |
| `ws.features.screenSharing.isHomePage` | not present |
| `ws.features.screenSharing.allowGuestShare` | `ws.permissions.guestAllowShare` |
| `ws.features.screenSharing.allowGuestJoin` | `ws.permissions.guestAllowJoin` |
| `ws.features.serviceSharing.isHomePage` | not present |
| - | `ws.permissions.guestAllowRelay` (unused) |
| - | `ws.permissions.userRegister` (unused) |
| - | `ws.permissions.userRegisterRelay` (unused) |

So the WS server has never started against a valid configuration file. Decide
one shape, then make the schema, `conf/config.example.json` and `ws.js` agree.

## Decisions to make

1. **One SMTP server or a list.** The schema says one (`email`), the code wanted
   a list and used `this.mailers[0]` as the sender anyway. One is enough unless
   failover is wanted.
2. **`isHomePage` / `serviceSharing`.** These drove which screen the client opens
   on. They have no schema equivalent - either add them under `permissions` (or a
   new `features` section) or drop the client behaviour with them.
3. **Relay permissions.** `guestAllowRelay` and `userRegisterRelay` are in the
   schema but nothing reads them. They belong to a relay feature that does not
   exist yet; keep them only if that feature is planned.

## Work

1. Settle the shape above; update `wsSchema` in `src/server/config.js`,
   `conf/config.example.json` and `tests/config.test.js` together.
2. Build the public config object in `ServerWS.start`. Only fields the browser
   may see: ICE servers, which auth providers are enabled and their public client
   ids, and the guest permissions. Never key material, SMTP credentials, OAuth
   client secrets or database settings.
3. Add the `conf-get` branch to `handleAPI`, answering that object.

What was built mirrors the names in the schema rather than the old `screenSharing`
grouping, and leaves out what the schema has no field for:

```
{"type": "conf-get"}   ->   {"webrtc": {"iceServers": [...]},
                             "permissions": {"guestAllowShare": bool,
                                             "guestAllowJoin": bool},
                             "auth": {"google": {"clientId": "..."}}}
```

## Client side

`src/client/web/src/server.js` invokes `conf-get` as the first message after the
communicator syncs, and closes the socket when it fails or answers `undefined`,
so the client cannot get past connecting until this exists. The answer is stored
as `conf["remote"]` and read all over the UI.

Worth doing at the same time: the client learns the server version from
`index.json` over HTTP (`version`, written by `buildConfFile`), but the WS
server now answers `version-check` too. Have the client check its version over
the socket after connecting, and show a download list when the versions differ -
`index.json` no longer carries one, so it has to come over the socket.
