"use strict";
let IdbHelper = {};
/*
    Note:
        Database -
                - List Databases not work in firefox,
                - Any search/get/delete on non-exist database will create a new one.
                - After get Database object use close() to finish database. IDBDatabase.close()
        Table - 
                - Cannot create in opened database, use run IDBObjectStore.transaction.db.close() to close
                - After get Table object use close() to finish connection IDBObjectStore.transaction.abort() for all IDBObjectStore.transaction.db.close()
                - Delete Table close parent Database
        Row -
*/
{
    const promisifyRequest = function(request) {
        return new Promise((resolve, reject) => {
            request.oncomplete = request.onsuccess = function(event) {
                resolve(event.target.result);
            };
            request.onabort = request.onerror = function(event) {
                reject(event.target.error);
            };
        });
    };
    const promisifyRequestLazy = function(request) {
        return new Promise((resolve, reject) => {
            request.oncomplete = request.onsuccess = function(event) {
                resolve(event.target.result);
            };
            request.onabort = request.onerror = function(event) {
                resolve(undefined);
            };
        });
    };
    const DBOpenRequest = async function(dbName) {
        const DBOpenRequest = indexedDB.open(dbName);
        return await promisifyRequest(DBOpenRequest);
    };
    const DBModifyRequest = async function(db, tableNames, isCreate=true) {
        //modify filter
        const tableNamesModify = [];
        for (const tableName of tableNames) {
            if (isCreate && db.objectStoreNames.contains(tableName)) {
                continue;
            } else if (isCreate === false && db.objectStoreNames.contains(tableName) === false) {
                continue;
            } else {
                tableNamesModify.push(tableName);
            }
        }
        tableNames = tableNamesModify;

        //modify
        if (tableNames.length === 0) {
            return db;
        }
        const version = db.version;
        const name = db.name;
        db.close();
            
        const DBOpenRequest = indexedDB.open(name, version+1);
        DBOpenRequest.blocked = function(event) {
            throw new Error("Something blocked IndexedDB database ("+name+")");
        };
        DBOpenRequest.onupgradeneeded = function(event) {
            const db = event.target.result;
            // Create/Delete an objectStore for this database
            if (isCreate === true) {
                for (const tableName of tableNames) {
                    db.createObjectStore(tableName);
                }
                    
            } else {
                for (const tableName of tableNames) {
                    db.deleteObjectStore(tableName);
                }
            }
        };
        return await promisifyRequest(DBOpenRequest);
    };
    const DBTableRequest = function(db, tableName, isReadOnly=false) {
        const mode = (isReadOnly ? "readonly": "readwrite");
        try {
            const table = db.transaction(tableName, mode, {"durability": "strict"}).objectStore(tableName);
            return table;
        } catch (error) {
            return undefined;
        }
    };

    
    /**
     * Database functions:
     */
    const StorageClear = async function() {
        //list databases (firefox not supported)
        const waits = [];
        const dbs = await indexedDB.databases();
        for (const {name} of dbs) {
            const DBDeleteRequest = indexedDB.deleteDatabase(name);
            waits.push(promisifyRequest(DBDeleteRequest));
        }
        await Promise.all(waits);
    };
    const DatabaseKeys = async function() {
        //list databases (firefox not supported)
        const dbNames = [];
        const dbs = await indexedDB.databases();
        for (const {name} of dbs) {
            dbNames.push(name);
        }
        return dbNames;
    };
    const DatabaseGet = async function(dbname) {
        return await DBOpenRequest(dbname);
    };
    const DatabaseSet = DatabaseGet;
    const DatabaseDel = async function(dbName) {
        const DBDeleteRequest = indexedDB.deleteDatabase(dbName);
        await promisifyRequest(DBDeleteRequest);
    };
    const DatabaseClear = async function(dbName) {
        let db = await DBOpenRequest(dbName);
        const tableNames = [];
        for (const tableName of db.objectStoreNames) {
            tableNames.push(tableName);
        }
        db = await DBModifyRequest(db, tableNames, false);
        db.close();
    };

    /**
     * Table functions:
     */
    const TableKeys = function(db) {
        const tableNames = [];
        for (const tableName of db.objectStoreNames) {
            tableNames.push(tableName);
        }
        return tableNames;
    };
    const TableSet = async function(dbName, tableName) {
        let db = await DBOpenRequest(dbName);
        //collect names
        let tableNames = [];
        if (typeof tableName === "string") {
            tableNames.push(tableName);
        } else if (tableName instanceof Array) {
            tableNames = tableName;
        }
        //set
        db = await DBModifyRequest(db, tableNames, true);
        db.close();
    };
    const TableDel = async function(dbName, tableName) {
        let db = await DBOpenRequest(dbName);
        //collect names
        let tableNames = [];
        if (typeof tableName === "string") {
            tableNames.push(tableName);
        } else if (tableName instanceof Array) {
            tableNames = tableName;
        }
        //set
        db = await DBModifyRequest(db, tableNames, false);
        db.close();
    };
    const TableClear = async function(table) {
        const request = table.clear();
        await promisifyRequest(request);
    };

    /**
     * Row functions:
     */
    const RowKeys = async function(db, tableName, start=0, length=Infinity, query=undefined) {
        return await new Promise(function(resolve) {
            const result = [];
            const table = DBTableRequest(db, tableName, true);
            const request = table.openKeyCursor(query);
            request.onsuccess = function(event) {
                //initial setup
                const cursor = event.target.result;
                if (!cursor) {
                    resolve(result);
                    return;
                }
                let i = 0;
                if (start === 0) {
                    result.push(cursor.key);
                    i++;
                    cursor.continue();
                } else {
                    cursor.advance(start);
                }
                //modify event for reading
                request.onsuccess = function(event) {
                    const cursor = event.target.result;
                    if (cursor && i < length) {
                        result.push(cursor.key);
                        i++;
                        cursor.continue();
                    } else {
                        resolve(result);
                    }
                };
            };
        });
    };
    const RowValues = async function(db, tableName, start=0, length=Infinity, query=undefined) {
        return await new Promise(function(resolve) {
            const result = [];
            const table = DBTableRequest(db, tableName, true);
            const request = table.openCursor(query);
            request.onsuccess = function(event) {
                //initial setup
                const cursor = event.target.result;
                if (!cursor) {
                    resolve(result);
                    return;
                }
                let i = 0;
                if (start === 0) {
                    result.push(cursor.value);
                    i++;
                    cursor.continue();
                } else {
                    cursor.advance(start);
                }
                //modify event for reading
                request.onsuccess = function(event) {
                    const cursor = event.target.result;
                    if (cursor && i < length) {
                        result.push(cursor.value);
                        i++;
                        cursor.continue();
                    } else {
                        resolve(result);
                    }
                };
            };
        });
    };
    const RowEntries = async function(db, tableName, start=0, length=Infinity, query=undefined) {
        return await new Promise(function(resolve) {
            const result = [];
            const table = DBTableRequest(db, tableName, true);
            const request = table.openCursor(query);
            request.onsuccess = function(event) {
                //initial setup
                const cursor = event.target.result;
                if (!cursor) {
                    resolve(result);
                    return;
                }
                let i = 0;
                if (start === 0) {
                    result.push([cursor.key, cursor.value]);
                    i++;
                    cursor.continue();
                } else {
                    cursor.advance(start);
                }
                //modify event for reading
                request.onsuccess = function(event) {
                    const cursor = event.target.result;
                    if (cursor && i < length) {
                        result.push([cursor.key, cursor.value]);
                        i++;
                        cursor.continue();
                    } else {
                        resolve(result);
                    }
                };
            };
        });
    };
    const RowCount = async function(db, tableName, query=undefined) {
        const table = DBTableRequest(db, tableName, true);
        const request = table.count(query);
        return await promisifyRequest(request);
    };

    const RowGet = async function(db, tableName, entries) {
        const waits = [];
        if (entries?.[0] instanceof Array) {
            const table = DBTableRequest(db, tableName);
            for (const [key, value] of entries) {
                const task = new Promise(async function(resolve) {
                    const curValue = await promisifyRequestLazy(table.get(key));
                    if (typeof curValue === "undefined") {
                        await promisifyRequestLazy(table.put(value, key));
                        resolve(value);
                    } else {
                        resolve(curValue);
                    }
                });
                waits.push(task);
            }
        } else {
            const table = DBTableRequest(db, tableName, true);
            for (const key of entries) {
                waits.push(promisifyRequestLazy(table.get(key)));
            }
        }
        return await Promise.all(waits);
    };
    const RowSet = async function(db, tableName, entries) {
        const table = DBTableRequest(db, tableName);
        const waits = [];
        for (const [key, value] of entries) {
            waits.push(promisifyRequestLazy(table.put(value, key)));
        }
        await Promise.all(waits);
    };
    const RowDel = async function(db, tableName, keys) {
        const table = DBTableRequest(db, tableName);
        const waits = [];
        for (const key of keys) {
            waits.push(promisifyRequestLazy(table.delete(key)));
        }
        await Promise.all(waits);
    };
    const RowUpdate = async function(db, tableName, entries) {
        const table = DBTableRequest(db, tableName);
        const waits = [];
        for (const [key, value] of entries) {
            const task = new Promise(async function(resolve) {
                const curValue = await promisifyRequestLazy(table.get(key));
                const newValue = value(curValue);
                await promisifyRequestLazy(table.put(newValue, key));
                resolve(undefined);
            });
            waits.push(task);
        }
        await Promise.all(waits);
    };

    
    //test
    /**(async function() {
        console.log(await DatabaseKeys());
        console.log(await DatabaseGet("created-db"));
        console.log((await DatabaseGet("deleted-db")).close());
        setTimeout(async function() {
            console.log(await DatabaseDel("deleted-db"));
        }, 1000);
    }());
    //test
    (async function() {
        console.log(await TableSet("created-db", "created-table3"));
        console.log(await TableDel("created-db", "created-table3"));

        const db = await DatabaseGet("created-db");
        console.log(TableKeys(db));
        console.log(db.close());
    }());*/
    //test
    /*(async function() {
        console.log(await TableSet("created-db", "created-table"));

        const db = await DatabaseGet("created-db");
        console.log(db);
        console.log(await RowKeys(db, "created-table"));
        console.log(await RowValues(db, "created-table"));
        console.log(await RowEntries(db, "created-table"));
        console.log(await RowCount(db, "created-table"));

        console.log(await RowGet(db, "created-table", ["aaa", "bbb"]));
        console.log(await RowGet(db, "created-table", [["aaa2", "aaa_val"], ["bbb", "bbb_val"]]));
        console.log(await RowSet(db, "created-table", [["aaa3", "aaa_val"], ["bbb3", "bbb_val"]]));
        console.log(await RowDel(db, "created-table", ["aaa2", "bbb_val"]));
        console.log(await RowUpdate(db, "created-table", [["aaa3", function(str) {return str+"as"}]]));
        console.log(await RowUpdate(db, "created-table", [["aaa3", function(str) {return str+"as"}]]));
        setTimeout(async function() {
            console.log(await RowUpdate(db, "created-table", [["aaa3", function(str) {return str+"as"}]]));
        }, 1000);
    }());*/
    IdbHelper = {
        StorageClear,
        DatabaseKeys,
        DatabaseGet,
        DatabaseSet,
        DatabaseDel,
        DatabaseClear,
        TableKeys,
        TableSet,
        TableDel,
        TableClear,
        RowKeys,
        RowValues,
        RowEntries,
        RowCount,
        RowGet,
        RowSet,
        RowDel,
        RowUpdate
    };
};