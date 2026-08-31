# WS accounts, sign-in and persistent sessions

Restore everything between a connected socket and a signed-in user: e-mail
sending, Google sign-in, sessions that survive a reconnect, live user data, and
account deletion.

Source of the removed code: `git show 6c0d18a:src/server/ws.js` -
`start()` 180-326 (mailers, `authGoogle`), `addSession` 327-377,
`updateSession` 378-454, `removeSession` 455-492, `addClientSession` 493-511,
`removeClientSession` 512-552, `addClientSubscription` 553-561,
`removeClientSubscription` 562-584, `updateUserData` 1228-1282, and the
`handleAPI` branches listed below.

Depends on [ws-database.md](ws-database.md) and [ws-client-config.md](ws-client-config.md).

## Two different session ids

`ws.js` today generates a **connection** session id in `generateSessionId()`: ten
characters, unique among live connections, gone when the socket closes, never
written anywhere. This plan adds the **account** session - a `sessions` row with
a `session_id` and a secret `session_key`, an expiry and the last used time, that
outlives the socket and lets a returning client sign in without Google.

Keep them apart. A client holds a `sessionKey` in local storage and replays it
through `login-session`; the connection id identifies the socket for the lifetime
of that socket and nothing else.

## Per-connection state

The removed `clientConnect` put more in the client `Map` than the current two
entries. Signed-in connections need:

```
"isLoggedIn": boolean
"userId": string
"sessionId": string      // the account session, not the connection id
```

and `ServerWS` needs the indexes that map account state back to sockets:

```
sessions      = Map<sessionId, Set<connectionId>>
subscriptions = Map<"email"|"firstName"|"lastName"|"picture"|"sessions"|"devices"|"shares",
                    Map<userId, Set<connectionId>>>
```

All of it is in-memory, which is what makes the WS server single-process. Say so
out loud before anything is built that assumes more than one instance.

## Mail

`start()` built nodemailer transports from the SMTP configuration and called
`transporter.verify()` on each, throwing when one failed, and throwing again when
none were configured. Only `this.mailers[0]` was ever used to send. See
[ws-client-config.md](ws-client-config.md) for the `email` vs `emails` shape
question, and make mail optional when no auth provider is configured.

## Google sign-in

No client library. `start()` built `this.authGoogle(credential)` which fetched
`https://oauth2.googleapis.com/tokeninfo?id_token=<credential>` with
`httpsGetText` from `common.js` and checked three things before trusting the
payload: `aud` equals the configured client id, `email_verified` is `"true"`, and
`exp` is in the future. It returned `undefined` on any failure, and a stub
returning `undefined` replaced it when Google was not configured.

Keep all three checks. A token that verifies against the wrong `aud` is somebody
else's token.

## API

| type | request | answer |
| --- | --- | --- |
| `login-google` | `{"credential", "userAgent"}` | `{"success", "sessionId", "sessionKey"}` |
| `login-session` | `{"sessionKey"}` | `{"success"}` |
| `logout` | `{"sessionId"}` (defaults to own) | `{"success"}` |
| `user-data-subscribe` | `{"key", "once", ...params}` | `{"success", "value"}` |
| `user-data-unsubscribe` | `{"key"}` | `{"success"}` |
| `delete-email` | `{"lang"}` | `{"success"}` |
| `delete` | `{"deleteKey"}` | `{"success"}` |

Server-initiated events on the same socket:

```
{"timestamp": number,
 "type": "logout" | "email" | "firstName" | "lastName" | "picture" | "sessions" | "devices" | "shares",
 "isChange": boolean, "isRemove": boolean, "value": any}
```

`user-data-subscribe` answers with the current value and then keeps sending these
until `user-data-unsubscribe`; `once` asks for the value without subscribing.
`picture` is fetched with `httpsGetImage` and sent as data, not as a Google URL.

`handleAPI` also refreshed the account session on **every** message from a
signed-in connection - expiry pushed seven days out, `last_used` and the IP
updated - and signed the client out when the row was gone. That is one database
write per message; consider refreshing on an interval instead.

## Account deletion

`delete-email` wrote a `delete` row (`delete_id`, `delete_key`, one hour expiry)
and mailed the key to the account address. `delete` took the key back, checked
the expiry, and removed the user - the cascading foreign keys took the Google
link, the sessions and the joins with it. The mail body was built from
`getText("delete.0"|"delete.1"|"delete.2", lang)` plus `this.domain`.

**`getText` was never imported.** The removed file imported only
`{ generateId, httpsGetText, httpsGetImage }` from `common.js`, and
`src/server/localization.js` exports `get`, not `getText`, so both this flow and
the room naming in the pairing plan would have thrown at runtime. Import and name
it properly when restoring.

## Work

1. Extend the connection state and add the `sessions` / `subscriptions` indexes.
2. Restore the mailers and `authGoogle` in `start()`, against the settled config.
3. Restore `addSession` / `updateSession` / `removeSession` and the
   client-to-session bookkeeping, including removing every socket of a session
   when it is deleted.
4. Restore the sign-in, sign-out, user data and deletion branches of `handleAPI`.
5. Extend the socket close handler to unwind the session and the subscriptions -
   the current one only releases the communicator.
