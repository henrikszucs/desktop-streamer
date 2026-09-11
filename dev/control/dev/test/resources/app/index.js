"use strict";

const path = require("node:path");
const os = require("node:os");
const { ipcRenderer } = require("electron");

ipcRenderer.on("api", function(event, ...args) {
    console.log(args[1]);
});


const main = async function() {
    // load native module
    const appPath = await ipcRenderer.invoke("api", "path-app");
    let packagePath = path.join(appPath, "../../../../dist", os.platform() + "-" + os.arch(), "easy-control.node");
    globalThis.Control = require(packagePath);
    console.log(Control);

    
    /*d
    setTimeout( function() {Control.Keyboard.keyDown("a");Control.Keyboard.keyUp("a");}, 1000);
    */

    document.getElementById("start-btn").addEventListener("click", async function() {
        const logElem = document.getElementById("log");
        logElem.innerHTML = "";

        return;

        // place Window
        ipcRenderer.send("api", "set-primary-monitor");
        ipcRenderer.send("api", "maximize-window");
        const bounds = await ipcRenderer.invoke("api", "get-content-bounds");
        console.log("Window bounds:", bounds);
        await new Promise(resolve => setTimeout(resolve, 500));

        //test Screen API
        const screenData = Control.Screen.list();
        const screenDataElectron = await ipcRenderer.invoke("api", "list-screens");
        
        if (screenData.length !== screenDataElectron.length) {
            console.log("Screens:", screenData);
            console.log("Screens:", screenDataElectron);
            throw new Error("Screen count mismatch!");
        }
        for (let i = 0; i < screenData.length; i++) {
            if (screenDataElectron[i]["bounds"]["width"] !== screenData[i]["width"] ||
                screenDataElectron[i]["bounds"]["height"] !== screenData[i]["height"] ||
                screenDataElectron[i]["bounds"]["x"] !== screenData[i]["x"] ||
                screenDataElectron[i]["bounds"]["y"] !== screenData[i]["y"] ||
                screenDataElectron[i]["scaleFactor"] !== screenData[i]["scaleFactor"]) {
                    console.log("Screens:", screenData);
                    console.log("Screens:", screenDataElectron);
                throw new Error("Screen data mismatch!");
            }
        }
        logElem.innerHTML += "<li style='color:green'>Screen API test passed.</li>";

        let mainMonitor = {};
        for (let i = 0; i < screenData.length; i++) {
            if (screenData[i]["isPrimary"]) {
                mainMonitor = screenData[i];
                break;
            }
        }

        //test Mouse API
        const testMouse = async function(x=Control.Mouse.getX(), y=Control.Mouse.getY()) {
            return new Promise((resolve, reject) => {
                let timeoutId = -1;
                const timeoutFn = function() {
                    clearTimeout(timeoutId);
                    window.removeEventListener("click", clickListener);
                    reject(new Error("Mouse click timeout!"));
                };
                const clickListener = async function (event) {
                    clearTimeout(timeoutId);
                    window.removeEventListener("click", clickListener);

                    const mousePosX = event.clientX;
                    const mousePosY = event.clientY;
                    console.log("Mouse position:", mousePosX, mousePosY);
                    const mouseAPIPosX = Math.floor(Control.Mouse.getX())-bounds["x"];
                    const mouseAPIPosY = Math.floor(Control.Mouse.getY())-bounds["y"];
                    console.log("Mouse position from API:", mouseAPIPosX, mouseAPIPosY);

                    if (Math.abs(mousePosX - mouseAPIPosX) > 1 || Math.abs(mousePosY - mouseAPIPosY) > 1) {
                        console.log("Expected position:", x, y);
                        reject(new Error("Mouse position mismatch!"));
                    }
                    resolve(true);
                };
                window.addEventListener("click", clickListener);
                Control.Mouse.setX(x);
                Control.Mouse.setY(y);
                Control.Mouse.buttonDown("left");
                Control.Mouse.buttonUp("left");
                timeoutId = setTimeout(timeoutFn, 1000);
            });
            
        };
        const testMouse2 = async function(x=Control.Mouse.getX(), y=Control.Mouse.getY()) {
            return new Promise((resolve, reject) => {
                let timeoutId = -1;
                const timeoutFn = function() {
                    clearTimeout(timeoutId);
                    window.removeEventListener("mouseup", clickListener);
                    reject(new Error("Mouse click timeout!"));
                };
                const btns = ["left", "middle", "right", "back", "forward"];
                const btnIndex = Math.floor(Math.random() * btns.length);
                const btn = btns[btnIndex];

                const clickListener = async function (event) {
                    clearTimeout(timeoutId);
                    window.removeEventListener("mouseup", clickListener);

                    const mousePosX = event.clientX;
                    const mousePosY = event.clientY;
                    console.log("Mouse position:", mousePosX, mousePosY);
                    const mouseAPIPosX = Math.floor(Control.Mouse.getX())-bounds["x"];
                    const mouseAPIPosY = Math.floor(Control.Mouse.getY())-bounds["y"];
                    console.log("Mouse position from API:", mouseAPIPosX, mouseAPIPosY);

                    if (Math.abs(mousePosX - mouseAPIPosX) > 1 || Math.abs(mousePosY - mouseAPIPosY) > 1) {
                        console.log("Expected position:", x, y);
                        reject(new Error("Mouse position mismatch!"));
                    }
                    if (event.button !== btnIndex) {
                        console.log("Expected button:", btnIndex, btn);
                        console.log("Received button:", event.button);
                        reject(new Error("Mouse button mismatch!"));
                    }
                    resolve(true);
                };
                
                window.addEventListener("mouseup", clickListener);

                Control.Mouse.setX(x);
                Control.Mouse.setY(y);
                Control.Mouse.buttonDown(btn);
                Control.Mouse.buttonUp(btn);
                timeoutId = setTimeout(timeoutFn, 1000);
            });
        };
        const getRandomPos = function() {
            const x = Math.floor(Math.random() * bounds["width"] -100) + bounds["x"] + 100;
            const y = Math.floor(Math.random() * bounds["height"] -100) + bounds["y"] + 100;
            return {
                "x": x,
                "y": y
            };
        };
        await testMouse(100, 100);
        await new Promise(resolve => setTimeout(resolve, 100));
        await testMouse(200, 150);
        await new Promise(resolve => setTimeout(resolve, 100));
        await testMouse(300, 200);
        await new Promise(resolve => setTimeout(resolve, 100));
        for (let i = 0; i < 20; i++) {
            await testMouse(getRandomPos()["x"], getRandomPos()["y"]);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        for (let i = 0; i < 20; i++) {
            await testMouse2(getRandomPos()["x"], getRandomPos()["y"]);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        
        const testMouseWheel = async function(isUp=true, delta=1, isHorizontal=false) {
            return new Promise((resolve, reject) => {
                let timeoutId = -1;
                const timeoutFn = function() {
                    clearTimeout(timeoutId);
                    window.removeEventListener("scroll", wheelListener);
                    console.log("Mouse wheel test:", isUp, delta, isHorizontal);
                    reject(new Error("Mouse wheel timeout!"));
                };
                const wheelListener = async function (event) {
                    clearTimeout(timeoutId);
                    window.removeEventListener("scroll", wheelListener);
                    resolve(true);
                };
                window.scrollTo(100, 100);
                window.addEventListener("scroll", wheelListener);
                if (isUp) {
                    Control.Mouse.scrollUp(delta, isHorizontal);
                } else {
                    Control.Mouse.scrollDown(delta, isHorizontal);
                }
                timeoutId = setTimeout(timeoutFn, 1000);
            });
        };
        for (let i = 0; i < 20; i++) {
            const isUp = Math.random() >= 0.5;
            const delta = Math.round(Math.random() * 5) + 1;
            const isHorizontal = Math.random() >= 0.5;
            await testMouseWheel(isUp, delta, isHorizontal);
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        logElem.innerHTML += "<li style='color:green'>Mouse API test passed.</li>";
        window.scrollTo(0, 0);

        //test Keyboard API
        let onKeyDown = [];
        let onKeyUp = [];
        window.addEventListener("keydown", function(event) {
            for (const fn of onKeyDown) {
                fn?.(event.code);
            }
        });
        window.addEventListener("keyup", function(event) {
            for (const fn of onKeyUp) {
                fn?.(event.code);
            }
        });
        const testKeyFn = (codeTarget) => {
            const testKey = async () => {
                return new Promise(async (resolve, reject) => {
                    const keyBtn = codeTarget;
                    const slowTime = 300;
                    let timeoutId = -1;
                    const timeoutFn = () => {
                        reject(new Error("Keydown timeout!"));
                    };

                    let isDown = false;
                    onKeyDown.push((code) => {
                        console.log("Key down event:", code);
                        if (code === keyBtn) {
                            isDown = true;
                        }
                    });

                    onKeyUp.push(async (code) => {
                        console.log("Key up event:", code);
                        if (code !== keyBtn) {
                            //console.error("Expected key:", keyBtn, "; Received key:", code);
                            //reject(new Error("Received key does not match!"));
                            return;
                        }

                        clearTimeout(timeoutId);
                        if (!isDown) {
                            reject(new Error("Key was not registered as down!"));
                            return;
                        }
                        console.log("Expected key:", keyBtn, "; Received key:", code);
                        resolve(true);
                    });
                    console.log("Down:", keyBtn);
                    Control.Keyboard.keyDown(keyBtn);
                    console.log("Up:", keyBtn);
                    Control.Keyboard.keyUp(keyBtn);
                    timeoutId = setTimeout(timeoutFn, slowTime * 4);
                });
            };
            return testKey;
        };
        const keysToTest = ["KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyJ", "KeyK", "KeyL", "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR", "KeyS", "KeyT", "KeyU", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ", "Digit0", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Escape", "Backspace"];
        const testFns = [];
        for (let i = 0; i < keysToTest.length; i++) {
            testFns.push(testKeyFn(keysToTest[i]));
        }
        for await (const test of testFns) {
            await test();
        }
        logElem.innerHTML += "<li style='color:green'>Keyboard API test passed.</li>";

        //test Controller API
        const gamepad = Control.Gamepad.create();

        console.log("Listing gamepads...");
        const controller = Control.Gamepad.list();
        console.log("Gamepads:", controller);
        if (controller.length === 0) {
            logElem.innerHTML += "<li style='color:orange'>No gamepads detected. Connect a gamepad and try again.</li>";
            return;
        }

        
        console.log("Created gamepad:", gamepad);
        console.log("Waiting 3 seconds for gamepad to be recognized by the system...");
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await new Promise(resolve => setTimeout(resolve, 500));
        gamepad.buttonDown(0);
        await new Promise(resolve => setTimeout(resolve, 1000));
        gamepad.buttonUp(0);

        const testBtn = async function(gamepad, btnId, isPress=false) {
            if (isPress) {
                gamepad.buttonDown(btnId);
            } else {
                gamepad.buttonUp(btnId);
            }
            await new Promise(resolve => setTimeout(resolve, 200));
            const gp = navigator.getGamepads()[0];
            if (gp.buttons[btnId].pressed !== isPress) {
                console.log("Expected button " + btnId + " to be " + (isPress ? "pressed" : "released") + ", but got " + (gp.buttons[btnId].pressed ? "pressed" : "released"));
                throw new Error("Gamepad button state mismatch for button " + btnId + "!");
            }
            console.log("Gamepad button " + btnId + " state correct:", gp.buttons[btnId].pressed);
        };
        console.log(navigator.getGamepads());
        const btnNum = 17;
        for (let i = 0; i < 20; i++) {
            const btnId = Math.floor(Math.random() * btnNum);
            const isPress = Math.random() >= 0.5;
            if (btnId === 6 || btnId === 7) {
                continue;
            }
            await testBtn(gamepad, btnId, isPress);
        }

        
        const testAxis = async function(gamepad, axisId, value) {
            gamepad.setAxis(axisId, value);
            await new Promise(resolve => setTimeout(resolve, 250));
            const gp = navigator.getGamepads()[0];
            console.log(gp.axes);
            const axisVal = gp.axes[axisId];
            console.log("Gamepad axis " + value + " value correct:", axisVal);
            if (Math.abs((axisVal+1) - (value+1)) > 0.3) {
                throw new Error("Gamepad axis value mismatch for axis " + axisId + "!");
            }
            console.log("Gamepad axis " + axisId + " value correct:", axisVal);
        };

        const vals = [-1, -0.7, -0.5, -0.3, 0, 0.3, 0.5, 0.7, 1]; 
        for (let i = 0; i < 4; i++) {
            for (let axis = 1; axis < vals.length; axis++) {
                await testAxis(gamepad, i, vals[axis]);
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
        gamepad.destroy();
        logElem.innerHTML += "<li style='color:green'>Gamepad API test passed.</li>";
    });

};
main();
window.addEventListener("gamepadconnected", (e) => {
            console.log(
                "Gamepad connected at index %d: %s. %d buttons, %d axes.",
                e.gamepad.index,
                e.gamepad.id,
                e.gamepad.buttons.length,
                e.gamepad.axes.length,
            );
        });