"use strict";

// the persistence of the WS server: the knex connection and the tables it
// creates on first boot. Only the tables the server actually reads are here -
// the accounts half of the schema comes with dev/plans/ws-accounts.md.

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import fs from "node:fs/promises";

// third-party dependencies
import knex from "knex";

// A remembered join has no owner yet: `peer_user_id` and `host_user_id` are
// there because the accounts plan will fill them, and they carry no foreign key
// until the `users` table they would point at exists. What identifies a side
// today is the code it holds - see dev/plans/ws-pairing-joins.md.
const createTables = async function(db) {
    if (await db.schema.hasTable("joins") === true) {
        return;
    }

    // created first and altered after, because MySQL cannot index a TEXT column
    // without a key length: what is indexed is a string, what is free is text
    await db.schema.createTable("joins", function(table) {
        table.string("join_id").primary();
        table.string("peer_code");
        table.string("host_code");
        table.string("peer_user_id").defaultTo("");
        table.string("host_user_id").defaultTo("");
        table.text("peer_name").defaultTo("");
        table.text("host_name").defaultTo("");
        table.boolean("is_unsupervised").defaultTo(false);
        table.bigInteger("created").unsigned();
    });
    await db.schema.alterTable("joins", function(table) {
        table.unique("peer_code");
        table.unique("host_code");
    });
};

// the connection itself. knex connects lazily, so a `select 1` turns a bad
// configuration into an error the caller can print at boot instead of a failure
// on the first query somebody makes an hour later.
const startDatabase = async function(conf) {
    const database = conf["ws"]["database"];
    let db = null;

    if (database["type"] === "sqlite") {
        // `host` is where the database is, which for SQLite is a file: loadConfig
        // has already made the path absolute, but the folder around it is still
        // this side's to create
        await fs.mkdir(path.dirname(database["host"]), {"recursive": true});
        db = knex({
            "client": "better-sqlite3",
            "connection": {
                "filename": database["host"]
            },
            "useNullAsDefault": true,
            "pool": {
                // SQLite ignores the foreign keys in a schema without it, and
                // the pragma is per connection rather than per file
                "afterCreate": function(connection, done) {
                    connection.pragma("foreign_keys = ON");
                    done(null, connection);
                }
            }
        });
    } else {
        db = knex({
            "client": "mysql2",
            "connection": {
                "host": database["host"],
                "port": database["port"],
                "user": database["user"],
                "password": database["pass"],
                "database": database["db"]
            }
        });
    }

    try {
        await db.raw("select 1");
        await createTables(db);
    } catch (error) {
        await db.destroy();
        throw error;
    }
    return db;
};

// the pool has to be closed by name: an open MySQL pool keeps the process alive
// long after the last socket is gone, which is what a SIGINT is trying to end
const stopDatabase = async function(db) {
    if (db === null || typeof db === "undefined") {
        return;
    }
    await db.destroy();
};

export { startDatabase, stopDatabase, createTables };
export default { startDatabase, stopDatabase, createTables };
