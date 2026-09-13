"use strict";

// the persistence of the WS server: the knex connection and the tables it
// creates on first boot. Only the tables the server actually reads are here:
// the joins, the accounts with their sessions, and the delete keys mailed out
// for an account somebody is about to delete.

//
// Import dependencies
//
// internal dependencies
import path from "node:path";
import fs from "node:fs/promises";

// third-party dependencies
import knex from "knex";

// A remembered join is owned on one side only: `peer_user_id` is the account
// the device was signed in as when the pair was made ("" for a guest), and
// `host_user_id` stays empty because a share is the machine's rather than
// anybody's. Neither carries a foreign key - the table predates `users`, and
// the schema is only ever created, never altered - so the account deletion in
// handlers/accounts.js drops the devices itself. What identifies a side is
// still the code a socket presents - see handlers/joins.js.
//
// Every table is checked on its own: a database that ran the joins-only build
// has that table and none of the account ones, and a boot that returned at the
// first table it found would never create the rest.
const createTables = async function(db) {
    // created first and altered after, because MySQL cannot index a TEXT column
    // without a key length: what is indexed is a string, what is free is text
    if (await db.schema.hasTable("joins") === false) {
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
    }

    // an account: what every provider agrees on. The relay permission is on the
    // row because it is the user's, not the connection's - a guest reads it off
    // the configuration, an account off here (see handlers/accounts.js).
    if (await db.schema.hasTable("users") === false) {
        await db.schema.createTable("users", function(table) {
            table.string("user_id").primary();
            table.string("email");
            table.text("first_name").defaultTo("");
            table.text("last_name").defaultTo("");
            table.boolean("is_relay_allowed").defaultTo(false);
            table.bigInteger("created").unsigned();
        });
        await db.schema.alterTable("users", function(table) {
            table.unique("email");
        });
    }

    // the Google side of one: the subject id Google names the person by, which
    // is what a returning credential is matched on - never the e-mail, which a
    // person can change
    if (await db.schema.hasTable("users_google") === false) {
        await db.schema.createTable("users_google", function(table) {
            table.string("sub").primary();
            table.string("user_id").notNullable()
                .references("user_id").inTable("users").onDelete("CASCADE");
            table.text("picture").defaultTo("");
        });
    }

    // a signed-in device, outliving every socket it has: the key is what a
    // client presents to sign in again without Google, so it is unique and
    // never handed to anybody but the connection that made it
    if (await db.schema.hasTable("sessions") === false) {
        await db.schema.createTable("sessions", function(table) {
            table.string("session_id").primary();
            table.string("user_id").notNullable()
                .references("user_id").inTable("users").onDelete("CASCADE");
            table.string("session_key");
            table.bigInteger("expire").unsigned();
            table.bigInteger("last_used").unsigned();
            table.text("ip_address").defaultTo("");
            table.text("user_agent").defaultTo("");
        });
        await db.schema.alterTable("sessions", function(table) {
            table.unique("session_key");
        });
    }

    // a deletion asked for and not yet confirmed: the key mailed to the
    // account address, bound to the session that asked so that it is only good
    // on that device, and gone with that session or the account itself
    if (await db.schema.hasTable("delete") === false) {
        await db.schema.createTable("delete", function(table) {
            table.string("delete_id").primary();
            table.string("user_id").notNullable()
                .references("user_id").inTable("users").onDelete("CASCADE");
            table.string("session_id").notNullable()
                .references("session_id").inTable("sessions").onDelete("CASCADE");
            table.string("delete_key");
            table.bigInteger("expire").unsigned();
            table.bigInteger("created").unsigned();
        });
        await db.schema.alterTable("delete", function(table) {
            table.unique("delete_key");
        });
    }
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
