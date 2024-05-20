"use strict";

const { ipcRenderer } = require("electron");

window.addEventListener("load", async function() {
    await IdbHelper.TableSet("db", "table");
    const db = await IdbHelper.DatabaseGet("db");
    let url = await IdbHelper.RowGet(db, "table", [["url", ""]]);
    console.log(url);
    url = url[0];

    // URL input
    const urlEl = document.getElementById("url");
    urlEl.value = url;

    // Send button
    const connectEl = document.getElementById("connect");
    connectEl.addEventListener("click", async function() {
        await IdbHelper.RowSet(db, "table", [["url", urlEl.value]]);
        ipcRenderer.send("api", "change-tab-url", urlEl.value);
    });
});

//debug
ipcRenderer.on("api", function(event, ...arg) {
    if (arg[0] === "log") {
        console.log(arg[1]);
    }
})