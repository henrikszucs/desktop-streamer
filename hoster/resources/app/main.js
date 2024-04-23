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
    desktopCapturer
} = require("electron");
const { join, resolve } = require("node:path")
const { pathToFileURL } = require("url");
const partition = "persist:local_desktopstream";

// tool functions
const waitFunc = async (ms) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(ms);
        }, ms);
    });
};

const createMainWindow = () => {
    const win = new BrowserWindow({
        "width": 800,
        "height": 600,
        "icon": app.getAppPath() + "/favicon.png",
        "webPreferences": {
            "partition": partition,
            "contextIsolation": false,
            "nodeIntegration": true,
            "nodeIntegrationInWorker": true,
            "devTools": true
        }
    });

    win.loadURL("local://local.local/index.html");
    win.setMenu(null);
    win.on("close", (event) => {
        event.preventDefault();
        win.hide();
    });
    win.webContents.on("before-input-event", async (event, input) => {
        if (input.type === "keyDown" && input.key === "F12") {
            if (win.webContents.isDevToolsOpened()) {
                win.webContents.closeDevTools();
            } else {
                win.webContents.openDevTools({ "mode:": "right" });
            }
        }
    });
    return win;
};



//
// main app
//
let winMain = null;
// Lock
const isGotLock = app.requestSingleInstanceLock();
if (!isGotLock) {
    app.quit();
} else {
    app.on("second-instance", (event, commandLine, workingDirectory) => {
        if (winMain) {
            if (winMain.isMinimized()) {
                winMain.restore();
            } else if (!winMain.isVisible()) {
                winMain.show();
            }
            winMain.focus();
        }
    });

    // Main Behave
    //simulate web server at local://local.local
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
    app.whenReady().then(() => {
        //start web server simulator at local://local.local
        const ses = session.fromPartition(partition)
        ses.protocol.handle("local", (req) => {
            const { pathname } = new URL(req.url);
            if (pathname === "/") {
                pathname = "index.html";
            }
            // NB, this does not check for paths that escape the bundle, e.g.
            // app://bundle/../../secret_file.txt
            return net.fetch(pathToFileURL(join(app.getAppPath(), pathname)).toString())
        });


        // Main window
        winMain = createMainWindow();
        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                winMain = createMainWindow();
            }
        });

        // Tray
        const tray = new Tray(app.getAppPath() + "/favicon.png");
        tray.on("click", () => {
            if (winMain) {
                winMain.show();
            }
        });
        const menu = new Menu();
        const menuOpen = new MenuItem({
            "type": "normal",
            "label": "Open",
            "click": () => {
                if (winMain) {
                    winMain.show();
                }
            }
        });
        menu.append(menuOpen);
        const menuClose = new MenuItem({
            "type": "normal",
            "label": "Close",
            "click": () => {
                if (winMain) {
                    app.exit();
                }
            }
        });
        menu.append(menuClose);
        tray.setContextMenu(menu);
    });
    app.on("window-all-closed", () => {
        app.exit();
    });


    //handle API
    const handleAPI = async (handle, ...args) => {
        return new Promise(async (resolve) => {
            if (handle === "path-exe") {
                resolve(app.getPath("exe"));
            } else if (handle === "path-app") {
                resolve(app.getAppPath());
            } else if (handle === "sources") {
                const sources = await desktopCapturer.getSources({ types: ["window", "screen"] });
                const sourcesOutput = [];
                for (const source of sources) {
                    sourcesOutput.push({
                        "name": source.name,
                        "id": source.id
                    });
                }
                resolve(sourcesOutput);
            }
        });
    };
    ipcMain.on("api", async (event, ...args) => {
        await handleAPI(...args);
    });
    ipcMain.handle("api", async (event, ...args) => {
        return await handleAPI(...args);
    });
}