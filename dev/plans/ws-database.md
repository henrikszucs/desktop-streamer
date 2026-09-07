# WS database

Restore the persistence layer of the WS server: the knex connection and the
schema it creates on first boot.

**Half of this is done.** `src/server/ws/database.js` holds `startDatabase` /
`stopDatabase` and creates the `joins` table, because the remembered devices in
[ws-pairing-joins.md](ws-pairing-joins.md) needed a row that outlives both
sockets. What is left is the accounts half of the schema - `users`,
`users_google`, `sessions`, `delete` - and the foreign keys the `joins` table
will grow when there is a `users` table to point at. Two deviations from the
table below, both because there are no accounts yet: `peer_user_id` and
`host_user_id` are plain columns defaulting to `""` with no key, and `joins`
carries an `is_unsupervised` boolean and a `created` timestamp. Both branches
have been run: SQLite against a file, MySQL against 8.4, where the table comes
out as `varchar` for the indexed columns and `text` for the free ones (which is
what the create-then-alter is for), `tinyint(1)` for the boolean - so a flag
comes back as a 1 and `recordOf` in `handlers/joins.js` is what turns it into a
boolean again - and `bigint unsigned` for `created`. `stop()` was checked the
way the note below means it: the process exits on its own afterwards rather than
being held open by the pool.

Source of the removed code: `git show 6c0d18a:src/server/ws.js`, lines 53-178
(`startDatabase`).

The dependencies are still in `package.json` (`knex`, `better-sqlite3`,
`mysql2`), and `config.js` still validates and resolves the `ws.database`
section, so only the WS server lost its half.

## What the removed code did

`async startDatabase(conf)`, called from `start()` before anything else:

- **SQLite** (`database.type === "sqlite"`): client `better-sqlite3`, file
  `database.host` - both kinds say where the database is under the one key, and
  for SQLite that is a path (already resolved to an absolute one by
  `loadConfig`). It
  created the containing folder first, and used a `pool.afterCreate` hook to run
  `PRAGMA foreign_keys = ON` - SQLite ignores the foreign keys in the schema
  without it.
- **MySQL** (`database.type === "mysql"`): client `mysql2`, from
  `host`/`port`/`user`/`pass`/`db`.
- knex connects lazily, so it ran `select 1` to turn a bad configuration into an
  error the caller can print instead of a failure on the first query.
- Then created each missing table. Tables were created and then altered, because
  MySQL cannot index a `TEXT` column without a key length - the indexed columns
  are `string`, the free ones are `text`.

## Schema

| table | primary | columns | keys |
| --- | --- | --- | --- |
| `users` | `user_id` | `email` (string), `first_name`, `last_name` (text) | unique `email` |
| `users_google` | `sub` | `user_id`, `picture` (text) | FK `user_id` -> `users.user_id`, cascade |
| `sessions` | `session_id` | `user_id`, `session_key`, `expire`, `last_used` (unsigned bigint), `ip_address`, `user_agent` (text) | FK `user_id` cascade, unique `session_key` |
| `delete` | `delete_id` | `user_id`, `delete_key`, `expire` (unsigned bigint) | FK `user_id` cascade, unique `delete_key` |
| `joins` | `join_id` | `peer_code`, `host_code`, `peer_user_id`, `host_user_id`, `peer_name`, `host_name` | FK `peer_user_id` and `host_user_id` cascade |

All ids are `generateId(10)` from `src/server/common.js`, retried until the table
has no row with that value.

## Work

1. ~~Re-add `startDatabase(conf)` and a `db` field on `ServerWS`~~ - done, and it
   is called from `start()` before anything else, since a call that hands out a
   join must not be answerable before the table holding one exists. Note that
   `config.js` *requires* `ws.database`, so there is no unconfigured case: a
   database that cannot be reached fails the boot rather than starting a server
   that forgets everything.
2. ~~Close the pool in `stop()`~~ - done (`stopDatabase`), which is what the
   removed code never did.
3. Add the accounts tables and the `joins` foreign keys with
   [ws-accounts.md](ws-accounts.md). `dev/mysql_docker/` brings up a MySQL
   server for testing the non-SQLite path.

## Notes

- Creating tables only when absent means the schema can never change. Anything
  past the first release needs migrations, or a version row the boot checks.
- `joins` has no `is_remember` column; a row existing in the table *is* the
  remembered flag. `updateJoin` inserts and deletes rows for it, which the
  pairing plan describes.
