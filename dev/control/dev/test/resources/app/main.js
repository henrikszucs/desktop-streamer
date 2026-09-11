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
        "webPreferences": {
            "partition": partition,
            "contextIsolation": false,
            "nodeIntegration": true,
            "nodeIntegrationInWorker": true,
            "devTools": true
        }
    });
    
    win.loadURL(url);
    win.setMenu(null);
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
    
    // Wait for load
    await app.whenReady();

    // Simulate web server at local://local.local
    const ses = session.fromPartition(partition);
    ses.protocol.handle("local", function(req) {
        let { pathname } = new URL(req.url);
        if (pathname === "/" || pathname === "") {
            pathname = "index.html";
        }
        pathname = path.join(app.getAppPath(), pathname);
        pathname = url.pathToFileURL(pathname).toString();
        return net.fetch(pathname);
        
    });
    
    // Main window create "local://local.local/"
    winMain = createMainWindow("local://local.local/");
    app.on("activate", function() {
        if (BrowserWindow.getAllWindows().length === 0) {
            winMain = createMainWindow();
            //winMain.webContents.send("api", "log", "Logging");
        }
    });
    
    // Free when closed
    app.on("window-all-closed", function() {
        app.exit();
    });
    
    // External API
    const handleAPI = async function(handle, ...args) {
        if (handle === "path-exe") {
            return app.getPath("exe");
        } else if (handle === "path-app") {
            return app.getAppPath();
        } else if (handle === "list-screens") {
            return screen.getAllDisplays();
        } else if (handle === "maximize-window") {
            winMain.maximize();
        } else if (handle === "set-primary-monitor") {
            const primaryDisplay = screen.getPrimaryDisplay();
            const { x, y } = primaryDisplay.bounds;
            winMain.setPositon(x, y);
        } else if (handle === "get-content-bounds") {
            return winMain.getContentBounds();
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