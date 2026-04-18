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
    desktopCapturer,
    dialog
} = require("electron");
const path = require("node:path");
const url = require("node:url");
const os = require("node:os");
const cmd = require("node:child_process");
const partition = "persist:remote_desktop";


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
	app.commandLine.appendSwitch("ignore-certificate-errors"); //for debug
    
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
    // allow getDisplayMedia
    ses.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({"types": ["screen"]}).then((sources) => {
            // Grant access to the first screen found.
            callback({"video": sources[0], "audio": "loopback"})
        });
    })
    
    // Main window create "local://local.local/"
    let closeText = "Do you want to leave?";
    let closeText2 = "The connection will be closed.";
    let closeTextConfirm = "Exit";
    let closeTextCancel = "Stay";
    const createMainWindow = function(url="https://localhost") {
        const win = new BrowserWindow({
            "width": 800,
            "height": 600,
            "icon": path.join(app.getAppPath(), "media/favicon-32.png"),
            "webPreferences": {
                "partition": partition,
                "contextIsolation": false,
                "nodeIntegration": true,
                "nodeIntegrationInWorker": false,
                "devTools": true
            }
        });
        
        win.loadURL(url);
        win.setMenu(null);
        win.on("close", function(event) {
            if (tray !== null) {
                event.preventDefault();
                win.hide();
            }
        });

        // Track Escape key timeout
        let escapeTimeout = null;

        // Note: remove "async" here to guarantee synchronous preventDefault()
        win.webContents.on("before-input-event", function(event, input) {
            
            // Developer tools shortcut
            if (input.type === "keyDown" && input.key === "F12") {
                if (win.webContents.isDevToolsOpened()) {
                    win.webContents.closeDevTools();
                } else {
                    win.webContents.openDevTools({
                        mode: "right"
                    });
                }
            }
        });

        win.webContents.on("will-prevent-unload", (event) => {
            const choice = dialog.showMessageBoxSync(win, {
                "type": "question",
                "buttons": [closeTextConfirm, closeTextCancel],
                "title": closeText,
                "message": closeText2,
                "defaultId": 0,
                "cancelId": 1
            })
            const leave = (choice === 0)
            if (leave) {
                event.preventDefault()
            }
        })
        return win;
    };
    winMain = createMainWindow("https://g28azi.ddns.net");
    app.on("activate", function() {
        if (BrowserWindow.getAllWindows().length === 0) {
            winMain = createMainWindow();
            //winMain.webContents.send("api", "log", "Logging");
        }
    });
    
    // Tray
    let menu = new Menu();
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

    let tray = null;
    
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
        } else if (handle === "set-tray") {
            const isOn = args[0];
            if (isOn && tray === null) {
                tray = new Tray(path.join(app.getAppPath(), "media/favicon-32.png"));
                tray.on("click", function() {
                    if (winMain) {
                        winMain.show();
                    }
                });
                tray.setContextMenu(menu);
            } else if (!isOn && tray !== null) {
                tray.destroy();
                tray = null;
            }
                
        } else if (handle === "set-tray-text") {
            if (tray === null) {
                return false;
            }
            let openLabel = args[0];
            let closeLabel = args[1];
            menu = new Menu();
            const menuOpen = new MenuItem({
                "type": "normal",
                "label": openLabel,
                "click": function() {
                    if (winMain) {
                        winMain.show();
                    }
                }
            });
            menu.append(menuOpen);
            const menuClose = new MenuItem({
                "type": "normal",
                "label": closeLabel,
                "click": function() {
                    if (winMain) {
                        app.exit();
                    }
                }
            });
            menu.append(menuClose);
            tray.setContextMenu(menu);
            return true;
        } else if (handle === "set-close-text") {
            closeText = args[0];
            closeText2 = args[1];
            closeTextConfirm = args[2];
            closeTextCancel = args[3];
        } else if (handle === "set-fullscreen") {
            const isOn = args[0];
            winMain.setFullScreen(isOn);
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