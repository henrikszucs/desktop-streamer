# WS database

Restore the persistence layer of the WS server: the knex connection and the
schema it creates on first boot.

Source of the removed code: `git show 6c0d18a:src/server/ws.js`, lines 53-178
(`startDatabase`).

The dependencies are still in `package.json` (`knex`, `better-sqlite3`,
`mysql2`), and `config.js` still validates and resolves the `ws.database`
section, so only `ws.js` lost its half.

## What the removed code did

`async startDatabase(conf)`, called from `start()` before anything else:

- **SQLite** (`database.type === "sqlite"`): client `better-sqlite3`, file
  `database.file` (already resolved to an absolute path by `loadConfig`). It
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

1. Re-add `startDatabase(conf)` and a `db` field on `ServerWS`; call it from
   `start()` and only when `conf["ws"]["database"]` is configured.
2. Close the pool in `stop()` (`await this.db.destroy()`) - the removed code never
   did, which kept the process alive after SIGINT with a MySQL pool open.
3. `dev/mysql_docker/` brings up a MySQL server for testing the non-SQLite path.

## Notes

- Creating tables only when absent means the schema can never change. Anything
  past the first release needs migrations, or a version row the boot checks.
- `joins` has no `is_remember` column; a row existing in the table *is* the
  remembered flag. `updateJoin` inserts and deletes rows for it, which the
  pairing plan describes.
