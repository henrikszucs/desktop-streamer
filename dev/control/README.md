# easy-control
Simple and easy to use node.js module to simulate mouse, keyboard and gamepad input for Windows, MacOS and Linux.



## Usage

```js
// Module import
import { Mouse, Keyboard,  Gamepad, Screen } from "./dist/easy-control.mjs";
// CommonJS import
const { Mouse, Keyboard,  Gamepad, Screen } = require("./dist/easy-control.cjs");
// Electron import example (need OS absolute route to .node file)
const absolutePath = "/tmp/dist/easy-control.node"
const { Mouse, Keyboard, Gamepad, Screen } = require(absolutePath);

/*
    !!! Function calculate with X and Y positions logical scaled value (not the native resolution)!!!

    Example: 1920 x 1080 screen with 1.25 (125% scale) >> the sreen size will be 1536 x 864 and right bottom corner coorinates will be X:1536; Y:864

Note:
    - If you want convert normal pixel to scaled just divide by scale e.g. 1920/1.25 = 1536
    - If you want convert scaled pixel to normal just multiply is by scale e.g. 1536*1.25 = 1920
    - Node.js cannot known the true size of the screen (probably lack of GPU support), it will return 1.0 scale
*/
```

### Mouse
```js
const x = Mouse.getX();
const y = Mouse.getY();

const icon = Mouse.getIcon();
/*
{
    "width": 32,        // icon width
    "height": 32,       // icon height
    "data": [0,1,2...], // image in argb data
    "xOffset": 0,       // pointer X offset from icon
    "yOffset": 0        // pointer Y offset from icon
}
*/

Mouse.setX(x);
Mouse.setY(y);

Mouse.buttonDown(btn);  // "right" | "middle" | "left" | "back" | "forward"
Mouse.buttonUp(btn);    // "right" | "middle" | "left" | "back" | "forward"

Mouse.scrollDown(amount=1, isHorizontal=false); // down or right scroll
Mouse.scrollUp(amount=1, isHorizontal=false);   // up or left scroll
```

### Keyboard
```js

const isKeySupported = Keyboard.isKeySupported(key=""); // check if special key is supported.

Keyboard.keyDown(key="");   // key value is a KeyboardEvent "code" property string (https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values)
Keyboard.keyUp(key="");

Keyboard.type(char="");     // Character to type. "keyDown" with "keyUp" methods does with physical keyboard keys but if you want input layout dependent characters like ő,ú,ű on english keyboard, use this.

const layout = Keyboard.GetLayout();    // Get the current layout settings in string
Keyboard.SetLayout(layout="");  // Set the keyboard language setting, this affect keyDown, keyUp characters, Windows:https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/windows-language-pack-default-values?view=windows-11


```


### Gamepad
```js
/*
--------------------
On Windows for gamepad support need the latest ViGEm Bus Driver (https://vigembusdriver.com/download/)

--------------------
On Linux run few configuration to enable UInput
# Add your user to the input group
sudo usermod -a -G input $USER

# Create udev rule for uinput permissions
sudo tee /etc/udev/rules.d/99-uinput.rules << EOF
KERNEL=="uinput", MODE="0660", GROUP="input", OPTIONS+="static_node=uinput"
EOF

# Reload udev rules
sudo udevadm control --reload-rules && sudo udevadm trigger

# Load uinput module
sudo modprobe uinput

# Make it load on boot
echo "uinput" | sudo tee -a /etc/modules

--------------------



*/


const gamepads = Gamepad.list(); // return gamepad objects in array

const gamepad1 = await Gamepad.create();
gamepad1.isActive();

gamepad1.buttonDown(btn=0);
gamepad1.buttonUp(btn=0);
gamepad1.setAxis(axis=0, direction=0);

gamepad1.destroy();

/*
btn - number from 0 to 32
axis - number from 0 to 8
direction - number from -1 to 1

Example for standard Xbox360 controller corresponding values:
    btn=0 - A button
    btn=1 - B button
    btn=2 - X button
    btn=3 - Y button
    btn=4 - left button
    btn=5 - right button
    btn=6 - left trigger
    btn=7 - right trigger
    btn=8 - select button
    btn=9 - start button
    btn=10 - left stick button
    btn=11 - right stick button
    btn=12 - d-pad up button
    btn=13 - d-pad down button
    btn=14 - d-pad left button
    btn=15 - d-pad right button
    btn=16 - home button

    axis=0 - left stick horizontal direction: from -1 left to 1 right
    axis=1 - left stick vertical direction: from -1 up to 1 down
    axis=2 - right stick horizontal direction: from -1 left to 1 right
    axis=3 - right stick vertical direction: from -1 up to 1 down

*/



```


### Screen
```js
const screens = Screen.list();
/*
[
    {
        "isPrimary": true,
        "width": 1536,
        "height": 864,
        "x": 0,
        "y": 0,
        "scaleFactor": 1.25
    },
    {
        "isPrimary": false,
        "width": 1680,
        "height": 900,
        "x": -1680,
        "y": 0,
        "scaleFactor": 1
    }
]
*/
```

## Testing

The tests run in electron enviroment. Copy ./dev/test folder to electron app and run.

## Building

```
npm install
npm run build
```

### Uninstall
```
npm run uninstall
```

> [!CAUTION]
> For building need additional tools. It is different in every operating system.

### Dependencies
#### Windows
- install Visual Studio [https://visualstudio.microsoft.com/vs/community/](https://visualstudio.microsoft.com/vs/community/) and select "Desktop development with C++" bundle
- install Python 3.6+ [https://apps.microsoft.com/detail/9ncvdn91xzqp](https://apps.microsoft.com/detail/9ncvdn91xzqp)
- install CMake [https://cmake.org/download/](https://cmake.org/download/)
- ```npm install -g node-gyp```

#### MacOS
- install Xcode [https://apps.apple.com/us/app/xcode/id497799835](https://apps.apple.com/us/app/xcode/id497799835)

#### Linux
- ```sudo apt-get install libx11-dev libxtst-dev libxfixes-dev libxrandr-dev libpng-dev zlib1g-dev```


