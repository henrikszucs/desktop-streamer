"use strict";

import Control from "../dist/easy-control.cjs";


const main = async () => {
/*
    setTimeout(async () => {
        Control.Mouse.buttonDown("left");
        await new Promise((resolve) => setTimeout(resolve, 500));
        Control.Mouse.buttonUp("left");

        Control.Keyboard.keyDown("KeyA");
        Control.Keyboard.keyUp("KeyA");

        Control.Keyboard.type("ő");
    }, 2000);

    

    
    console.log(Control);
    console.log(Control.Mouse.getX());
    console.log(Control.Mouse.getY());
    console.log(Control.Mouse.getIcon());
    console.log(Control.Mouse.setX(1500));
    
   
    
 console.log(Control.Screen.list());
    console.log(Control.Controller.list());
    console.log(Control.Controller.isSupported());
    if (!Control.Controller.isSupported()) {
        console.log(await Control.Controller.install());
    }
    const controller = Control.Controller.create();
    console.log(controller);
    console.log(Control.Controller.list());
    for (let i = 0; i < 4; i++) {
        console.log("press button 1");
        controller.buttonDown(1);
        await new Promise((resolve) => setTimeout(resolve, 500));
        controller.buttonUp(1);
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    
    console.log(controller.isActive());
    console.log("turn off");
    controller.disconnect();
    console.log(controller.isActive());
    console.log(controller);
    console.log(Control.Controller.list());
    */
   /*
    console.log("Keyboard test");
    await new Promise((resolve) => setTimeout(resolve, 200));
    Control.Keyboard.keyDown("a");
    Control.Keyboard.keyUp("a");
    console.log("Keyboard test");
    await new Promise((resolve) => setTimeout(resolve, 200));
    Control.Keyboard.keyDown("ő");
    Control.Keyboard.keyUp("ő");
    await new Promise((resolve) => setTimeout(resolve, 200));
    Control.Keyboard.keyDown("Meta");
    Control.Keyboard.keyUp("Meta");*/

    console.log(Control.Gamepad);

    const gamepad1 = Control.Gamepad.create();
    console.log(gamepad1);
    console.log(gamepad1.isActive());
    console.log(Control.Gamepad.list());
    /*
    await new Promise((resolve) => setTimeout(resolve, 2000));
    for (let i = 0; i < 17; i++) {
        if (i === 6 || i === 7) {
            continue
        }
        console.log("Starting gamepad input simulation");
        gamepad1.buttonDown(i);
        await new Promise((resolve) => setTimeout(resolve, 400));
        gamepad1.buttonUp(i);
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    


    const vals = [-1, -0.7, -0.5, -0.3, 0, 0.3, 0.5, 0.7, 1]; 
    for (let i = 0; i < 4; i++) {
        for (let axis = 1; axis < vals.length; axis++) {
            gamepad1.setAxis(i, vals[axis]);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    console.log(gamepad1.destroy());
    console.log(Control.Gamepad.list());
    console.log(gamepad1.isActive());
    console.log(Control.Gamepad.list());
    */
};
main();
