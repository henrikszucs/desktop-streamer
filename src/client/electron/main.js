const {
    app,
    Tray,
    Menu,
    MenuItem,
    BrowserWindow,
    ipcMain,
    protocol,
    net,
    session,
    screen,
    desktopCapturer
} = require("electron");
const path = require("node:path");
const url = require("node:url");
const os = require("node:os");
const cmd = require("node:child_process");
const partition = "persist:remote_desktop";

// tool functions
const createMainWindow = function(url) {
    const win = new BrowserWindow({
        "width": 800,
        "height": 600,
        "icon": path.join(app.getAppPath(), "icons/icon-32.png"),
        "webPreferences": {
            "partition": partition,
            "contextIsolation": true,
            "nodeIntegration": false,
            "nodeIntegrationInWorker": false,
            "preload": path.join(app.getAppPath(), "src/client/electron/preload.js"),
            "devTools": true
        }
    });
    
    win.loadURL(url);
    win.setMenu(null);
    win.on("close", function(event) {
        event.preventDefault();
        win.hide();
    });
    win.webContents.on("before-input-event", async function(event, input) {
        if (input.type === "keyDown" && input.key === "F12") {
            if (win.webContents.isDevToolsOpened()) {
                win.webContents.closeDevTools();
            } else {
                win.webContents.openDevTools({
                    "mode:": "right"
                });
            }
        }
    });
    return win;
};


//
// main app
//
const main = async function() {
    let winMain = null;
    
    // Lock
    const isGotLock = app.requestSingleInstanceLock();
    if (!isGotLock) {
        app.quit();
        return;
    }
    app.on("second-instance", function(event, commandLine, workingDirectory) {
        if (winMain) {
            if (winMain.isMinimized()) {
                winMain.restore();
            } else if (!winMain.isVisible()) {
                winMain.show();
            }
            winMain.focus();
        }
    });
    
    // Simulate web server at local://local.local
    protocol.registerSchemesAsPrivileged([
        {
            "scheme": "local",
            "privileges": {
                "standard": true,
                "secure": true,
                "bypassCSP": true,
                "allowServiceWorkers": true,
                "supportFetchAPI": true,
                "corsEnabled": true,
                "stream": true
            }
        }
    ]);
    //for debug
	app.commandLine.appendSwitch("ignore-certificate-errors");
    
    // Wait for load
    await app.whenReady();

    // Simulate web server at local://local.local
    const ses = session.fromPartition(partition);
    ses.protocol.handle("local", function(req) {
        let { pathname } = new URL(req.url);
        if (pathname === "/" || pathname === "") {
            pathname = "index.html";
        }
        // NB, this does not check for paths that escape the bundle, e.g.
        // app://bundle/../../secret_file.txt
        const pathFull = url.pathToFileURL(path.join(app.getAppPath(), pathname)).toString();
        return net.fetch(pathFull);
    });
    
    // Main window create "local://local.local/"
    winMain = createMainWindow("https://localhost");
    app.on("activate", function() {
        if (BrowserWindow.getAllWindows().length === 0) {
            winMain = createMainWindow();
            //winMain.webContents.send("api", "log", "Logging");
        }
    });
    
    // Tray
    const tray = new Tray(path.join(app.getAppPath(), "icons/icon-32.png"));
    tray.on("click", function() {
        if (winMain) {
            winMain.show();
        }
    });
    const menu = new Menu();
    const menuOpen = new MenuItem({
        "type": "normal",
        "label": "Open",
        "click": function() {
            if (winMain) {
                winMain.show();
            }
        }
    });
    menu.append(menuOpen);
    const menuClose = new MenuItem({
        "type": "normal",
        "label": "Close",
        "click": function() {
            if (winMain) {
                app.exit();
            }
        }
    });
    menu.append(menuClose);
    tray.setContextMenu(menu);
    
    // Free when closed
    app.on("window-all-closed", function() {
        app.exit();
    });
    
    
    // Screen change event
    const screenChange = async function() {
        winMain.webContents.send("api", "screenchange");
    };
    screen.on("display-added", screenChange);
    screen.on("display-removed", screenChange);
    
    
    // External API
    const handleAPI = async function(handle, ...args) {
        if (handle === "path-exe") {
            return app.getPath("exe");
        } else if (handle === "path-app") {
            return app.getAppPath();
        } else if (handle === "list-screens") {
            const sources = await desktopCapturer.getSources({
                "types": ["window", "screen"]
            });
            const sourcesOutput = [];
            for (const source of sources) {
                sourcesOutput.push({
                    "name": source.name,
                    "id": source.id
                });
            }
            return sourcesOutput;
        } else if (hangle === "change-language") {

        }
    };
    ipcMain.on("api", async function(event, ...args) {
        await handleAPI(...args);
    });
    ipcMain.handle("api", async function(event, ...args) {
        return await handleAPI(...args);
    });
}
main();