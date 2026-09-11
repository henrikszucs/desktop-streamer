#include "gamepad.h"

#include <uv.h>
#include <vector>
#include <stdio.h>
#include <string.h>

#if defined(IS_WINDOWS)
    #include <windows.h>

    #include <shellapi.h>
    #pragma comment(lib, "shell32.lib")

    #include <setupapi.h>
    #pragma comment(lib, "setupapi.lib")

    #include <Xinput.h>
    #include <ViGEm/Client.h>
    #pragma comment(lib, "ViGEmClient.lib")
#elif defined(IS_MACOS)
    #import <Foundation/Foundation.h>
    #include "GamepadBridge.h"
#elif defined(IS_LINUX)
    #include <unistd.h>
    #include <sys/stat.h>
    #include <fcntl.h>
    #include <linux/uinput.h>
#endif

// Driver installation async implementation
InstallDriver::InstallDriver(const Napi::Env& env) : Napi::AsyncWorker{env, "InstallDriver"}, m_deferred{env} {}

Napi::Promise InstallDriver::GetPromise() {
    return m_deferred.Promise();
}

void InstallDriver::Execute() {
    
}

void InstallDriver::OnOK() {
    Napi::Boolean val = Napi::Boolean::New(Env(), m_result);
    m_deferred.Resolve(val);
}

void InstallDriver::OnError(const Napi::Error& err) {
    m_deferred.Reject(err.Value());
}



std::vector<Napi::ObjectReference> gamepads;

Napi::Value Gamepad::list(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::Array gamepadsArr = Napi::Array::New(env);
    for (size_t i = 0; i < gamepads.size(); i++) {
        gamepadsArr.Set(i, gamepads[i].Value());
    }
    return gamepadsArr;
}

Napi::Object Gamepad::CreateObject(const Napi::CallbackInfo& info) {
    Napi::Object gamepad = Gamepad::NewInstance(info.Env());
    
    Napi::ObjectReference ref = Napi::Persistent(gamepad);
    gamepads.push_back(std::move(ref));

    return gamepad;
}

Napi::Object Gamepad::NewInstance(Napi::Env env) {
    Napi::EscapableHandleScope scope(env);
    Napi::Object obj = env.GetInstanceData<Napi::FunctionReference>()->New({});
    Napi::Object ret = scope.Escape(napi_value(obj)).ToObject();
    return ret;
}

Gamepad::Gamepad(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Gamepad>(info) {
    #if defined(IS_WINDOWS)
        // allocate memory
        this->m_client = vigem_alloc();
        if (this->m_client == nullptr) {
            this->m_active = false;
            return;
        }

        // connect to the driver
        const auto retval = vigem_connect(this->m_client);
        if (!VIGEM_SUCCESS(retval)) {
            vigem_free(this->m_client);
            this->m_active = false;
            return;
        }

        // create a new Xbox 360 controller target
        this->m_pad = vigem_target_x360_alloc();
        const auto pir = vigem_target_add(this->m_client, this->m_pad);
        if (!VIGEM_SUCCESS(pir)) {
            vigem_target_remove(this->m_client, this->m_pad);
            vigem_target_free(this->m_pad);
            vigem_disconnect(this->m_client);
            vigem_free(this->m_client);
            this->m_active = false;
            return;
        }

        // Allocate the report structure
        this->m_report = new XUSB_REPORT();
        ZeroMemory(this->m_report, sizeof(XUSB_REPORT));

        this->m_active = true;

    #elif defined(IS_MACOS)
        // Create gamepad via GamepadBridge
        this->m_gamepad_id = [GamepadBridge createGamepad];
        if (this->m_gamepad_id >= 0) {
            this->m_active = true;
        } else {
            this->m_active = false;
        }

    #elif defined(IS_LINUX)
        // Linux specific initialization using uinput
        // Try multiple possible paths for uinput
        this->m_uinput_fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
        if (this->m_uinput_fd < 0) {
            // Try alternative path
            this->m_uinput_fd = open("/dev/input/uinput", O_WRONLY | O_NONBLOCK);
            if (this->m_uinput_fd < 0) {
                // Try without O_NONBLOCK
                this->m_uinput_fd = open("/dev/uinput", O_WRONLY);
                if (this->m_uinput_fd < 0) {
                    this->m_uinput_fd = open("/dev/input/uinput", O_WRONLY);
                    if (this->m_uinput_fd < 0) {
                        this->m_active = false;
                        return;
                    }
                }
            }
        }

        // Enable event types
        if (ioctl(this->m_uinput_fd, UI_SET_EVBIT, EV_KEY) < 0) {
            close(this->m_uinput_fd);
            this->m_uinput_fd = -1;
            this->m_active = false;
            return;
        }
        
        if (ioctl(this->m_uinput_fd, UI_SET_EVBIT, EV_ABS) < 0) {
            close(this->m_uinput_fd);
            this->m_uinput_fd = -1;
            this->m_active = false;
            return;
        }

        // Enable buttons (BTN_GAMEPAD + standard Xbox buttons)
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_SOUTH);      // A
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_EAST);       // B
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_NORTH);      // X
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_WEST);       // Y
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_TL);         // LB
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_TR);         // RB
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_SELECT);     // Back
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_START);      // Start
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_MODE);       // Guide
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_THUMBL);     // Left Stick
        ioctl(this->m_uinput_fd, UI_SET_KEYBIT, BTN_THUMBR);     // Right Stick

        // Enable axes
        ioctl(this->m_uinput_fd, UI_SET_ABSBIT, ABS_X);          // Left stick X
        ioctl(this->m_uinput_fd, UI_SET_ABSBIT, ABS_Y);          // Left stick Y
        ioctl(this->m_uinput_fd, UI_SET_ABSBIT, ABS_RX);         // Right stick X
        ioctl(this->m_uinput_fd, UI_SET_ABSBIT, ABS_RY);         // Right stick Y
        ioctl(this->m_uinput_fd, UI_SET_ABSBIT, ABS_Z);          // Left trigger
        ioctl(this->m_uinput_fd, UI_SET_ABSBIT, ABS_RZ);         // Right trigger
        ioctl(this->m_uinput_fd, UI_SET_ABSBIT, ABS_HAT0X);      // D-pad X
        ioctl(this->m_uinput_fd, UI_SET_ABSBIT, ABS_HAT0Y);      // D-pad Y

        // Setup device
        struct uinput_setup usetup;
        memset(&usetup, 0, sizeof(usetup));
        usetup.id.bustype = BUS_USB;
        usetup.id.vendor = 0x045e;  // Microsoft
        usetup.id.product = 0x028e; // Xbox 360 Controller
        usetup.id.version = 1;
        strncpy(usetup.name, "Virtual Xbox 360 Controller", UINPUT_MAX_NAME_SIZE);

        // Configure axis ranges
        struct uinput_abs_setup abs_setup;
        memset(&abs_setup, 0, sizeof(abs_setup));
        
        // Left stick X
        abs_setup.code = ABS_X;
        abs_setup.absinfo.minimum = -32768;
        abs_setup.absinfo.maximum = 32767;
        abs_setup.absinfo.value = 0;
        ioctl(this->m_uinput_fd, UI_ABS_SETUP, &abs_setup);
        
        // Left stick Y
        abs_setup.code = ABS_Y;
        ioctl(this->m_uinput_fd, UI_ABS_SETUP, &abs_setup);
        
        // Right stick X
        abs_setup.code = ABS_RX;
        ioctl(this->m_uinput_fd, UI_ABS_SETUP, &abs_setup);
        
        // Right stick Y
        abs_setup.code = ABS_RY;
        ioctl(this->m_uinput_fd, UI_ABS_SETUP, &abs_setup);
        
        // Triggers (0-255)
        abs_setup.absinfo.minimum = 0;
        abs_setup.absinfo.maximum = 255;
        abs_setup.code = ABS_Z;
        ioctl(this->m_uinput_fd, UI_ABS_SETUP, &abs_setup);
        
        abs_setup.code = ABS_RZ;
        ioctl(this->m_uinput_fd, UI_ABS_SETUP, &abs_setup);
        
        // D-pad (-1, 0, 1)
        abs_setup.absinfo.minimum = -1;
        abs_setup.absinfo.maximum = 1;
        abs_setup.code = ABS_HAT0X;
        ioctl(this->m_uinput_fd, UI_ABS_SETUP, &abs_setup);
        
        abs_setup.code = ABS_HAT0Y;
        ioctl(this->m_uinput_fd, UI_ABS_SETUP, &abs_setup);

        // Create the device
        if (ioctl(this->m_uinput_fd, UI_DEV_SETUP, &usetup) < 0) {
            close(this->m_uinput_fd);
            this->m_uinput_fd = -1;
            this->m_active = false;
            return;
        }
        
        if (ioctl(this->m_uinput_fd, UI_DEV_CREATE) < 0) {
            close(this->m_uinput_fd);
            this->m_uinput_fd = -1;
            this->m_active = false;
            return;
        }

        // Give the system time to create the device
        usleep(100000); // 100ms delay

        // Allocate state tracking
        this->m_state = new GamepadState();
        memset(this->m_state, 0, sizeof(GamepadState));

        this->m_active = true;
    #endif

    
};

Gamepad::~Gamepad() {
    this->m_active = false;
    #if defined(IS_WINDOWS)
        if (this->m_pad != nullptr) {
            vigem_target_remove(this->m_client, this->m_pad);
            vigem_target_free(this->m_pad);
            this->m_pad = nullptr;
        }
        if (this->m_client != nullptr) {
            vigem_disconnect(this->m_client);
            vigem_free(this->m_client);
            this->m_client = nullptr;
        }
        if (this->m_report != nullptr) {
            delete this->m_report;
            this->m_report = nullptr;
        }
    #elif defined(IS_MACOS)
        if (this->m_gamepad_id >= 0) {
            [GamepadBridge destroyGamepad:this->m_gamepad_id];
            this->m_gamepad_id = -1;
        }
    #elif defined(IS_LINUX)
        if (this->m_uinput_fd >= 0) {
            ioctl(this->m_uinput_fd, UI_DEV_DESTROY);
            close(this->m_uinput_fd);
            this->m_uinput_fd = -1;
        }
        if (this->m_state != nullptr) {
            delete this->m_state;
            this->m_state = nullptr;
        }
    #endif
}

Napi::Value Gamepad::IsActive(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, this->m_active);
}

void Gamepad::Destroy(const Napi::CallbackInfo& info) {
    Napi::Object thisObj = info.This().As<Napi::Object>();

    // call destructor
    this->~Gamepad();

    // Find and remove from the gamepads vector
    for (auto it = gamepads.begin(); it != gamepads.end(); ++it) {
        if (it->Value() == thisObj) {
            it->Reset();  // Release the persistent reference
            gamepads.erase(it);
            break;
        }
    }

    
}

void Gamepad::ButtonDown(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!this->m_active) {
        Napi::Error::New(env, "Gamepad is not active").ThrowAsJavaScriptException();
        return;
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Button index expected").ThrowAsJavaScriptException();
        return;
    }
    int btnIndex = info[0].As<Napi::Number>().Int32Value();

    if (btnIndex < 0 || btnIndex > 31) {
        Napi::RangeError::New(env, "Button index out of range (0-31)").ThrowAsJavaScriptException();
        return;
    }

    #if defined(IS_WINDOWS)
        USHORT buttonMask = 0;
        switch (btnIndex) {
            case 0: buttonMask = XUSB_GAMEPAD_A; break;
            case 1: buttonMask = XUSB_GAMEPAD_B; break;
            case 2: buttonMask = XUSB_GAMEPAD_X; break;
            case 3: buttonMask = XUSB_GAMEPAD_Y; break;
            case 4: buttonMask = XUSB_GAMEPAD_LEFT_SHOULDER; break;
            case 5: buttonMask = XUSB_GAMEPAD_RIGHT_SHOULDER; break;
            case 8: buttonMask = XUSB_GAMEPAD_BACK; break;
            case 9: buttonMask = XUSB_GAMEPAD_START; break;
            case 10: buttonMask = XUSB_GAMEPAD_LEFT_THUMB; break;
            case 11: buttonMask = XUSB_GAMEPAD_RIGHT_THUMB; break;
            case 12: buttonMask = XUSB_GAMEPAD_DPAD_UP; break;
            case 13: buttonMask = XUSB_GAMEPAD_DPAD_DOWN; break;
            case 14: buttonMask = XUSB_GAMEPAD_DPAD_LEFT; break;
            case 15: buttonMask = XUSB_GAMEPAD_DPAD_RIGHT; break;
            case 16: buttonMask = XUSB_GAMEPAD_GUIDE; break;
            case 6:
            case 7:
            default:
                Napi::RangeError::New(env, "Invalid button index").ThrowAsJavaScriptException();
                return;
        }

        // Set the button bit in current state
        this->m_report->wButtons |= buttonMask;

        // Update the gamepad
        const auto result = vigem_target_x360_update(this->m_client, this->m_pad, *this->m_report);
        if (!VIGEM_SUCCESS(result)) {
            Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
            return;
        }
    
    #elif defined(IS_MACOS)
        BOOL result = [GamepadBridge buttonDown:this->m_gamepad_id button:btnIndex];
        if (!result) {
            Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
            return;
        }
        
    #elif defined(IS_LINUX)
        // Map button index to Linux input button codes
        int buttonCode = -1;
        switch (btnIndex) {
            case 0: buttonCode = BTN_SOUTH; break;
            case 1: buttonCode = BTN_EAST; break;
            case 2: buttonCode = BTN_NORTH; break;
            case 3: buttonCode = BTN_WEST; break;
            case 4: buttonCode = BTN_TL; break;
            case 5: buttonCode = BTN_TR; break;
            case 8: buttonCode = BTN_SELECT; break;
            case 9: buttonCode = BTN_START; break;
            case 10: buttonCode = BTN_THUMBL; break;
            case 11: buttonCode = BTN_THUMBR; break;
            case 16: buttonCode = BTN_MODE; break;
            case 12: // D-pad Up
            case 13: // D-pad Down
            case 14: // D-pad Left
            case 15: // D-pad Right
                // D-pad handled via HAT axes
                {
                    struct input_event ev[2];
                    memset(ev, 0, sizeof(ev));
                    
                    if (btnIndex == 12) { // Up
                        ev[0].type = EV_ABS;
                        ev[0].code = ABS_HAT0Y;
                        ev[0].value = -1;
                    } else if (btnIndex == 13) { // Down
                        ev[0].type = EV_ABS;
                        ev[0].code = ABS_HAT0Y;
                        ev[0].value = 1;
                    } else if (btnIndex == 14) { // Left
                        ev[0].type = EV_ABS;
                        ev[0].code = ABS_HAT0X;
                        ev[0].value = -1;
                    } else if (btnIndex == 15) { // Right
                        ev[0].type = EV_ABS;
                        ev[0].code = ABS_HAT0X;
                        ev[0].value = 1;
                    }
                    
                    ev[1].type = EV_SYN;
                    ev[1].code = SYN_REPORT;
                    ev[1].value = 0;
                    
                    if (write(this->m_uinput_fd, ev, sizeof(ev)) < 0) {
                        Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
                        return;
                    }
                }
                return;
            case 6:
            case 7:
            default:
                Napi::RangeError::New(env, "Invalid button index").ThrowAsJavaScriptException();
                return;
        }

        if (buttonCode >= 0) {
            struct input_event ev[2];
            memset(ev, 0, sizeof(ev));
            
            ev[0].type = EV_KEY;
            ev[0].code = buttonCode;
            ev[0].value = 1; // Press
            
            ev[1].type = EV_SYN;
            ev[1].code = SYN_REPORT;
            ev[1].value = 0;
            
            if (write(this->m_uinput_fd, ev, sizeof(ev)) < 0) {
                Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
                return;
            }
        }
    #endif
}

void Gamepad::ButtonUp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!this->m_active) {
        Napi::Error::New(env, "Gamepad is not active").ThrowAsJavaScriptException();
        return;
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Button index expected").ThrowAsJavaScriptException();
        return;
    }
    int btnIndex = info[0].As<Napi::Number>().Int32Value();

    if (btnIndex < 0 || btnIndex > 31) {
        Napi::RangeError::New(env, "Button index out of range (0-31)").ThrowAsJavaScriptException();
        return;
    }


    #if defined(IS_WINDOWS)
        // Windows specific button down implementation
        // Map button index to Xbox 360 button
        USHORT buttonMask = 0;
        switch (btnIndex) {
            case 0: buttonMask = XUSB_GAMEPAD_A; break;
            case 1: buttonMask = XUSB_GAMEPAD_B; break;
            case 2: buttonMask = XUSB_GAMEPAD_X; break;
            case 3: buttonMask = XUSB_GAMEPAD_Y; break;
            case 4: buttonMask = XUSB_GAMEPAD_LEFT_SHOULDER; break;
            case 5: buttonMask = XUSB_GAMEPAD_RIGHT_SHOULDER; break;
            case 8: buttonMask = XUSB_GAMEPAD_BACK; break;
            case 9: buttonMask = XUSB_GAMEPAD_START; break;
            case 10: buttonMask = XUSB_GAMEPAD_LEFT_THUMB; break;
            case 11: buttonMask = XUSB_GAMEPAD_RIGHT_THUMB; break;
            case 12: buttonMask = XUSB_GAMEPAD_DPAD_UP; break;
            case 13: buttonMask = XUSB_GAMEPAD_DPAD_DOWN; break;
            case 14: buttonMask = XUSB_GAMEPAD_DPAD_LEFT; break;
            case 15: buttonMask = XUSB_GAMEPAD_DPAD_RIGHT; break;
            case 16: buttonMask = XUSB_GAMEPAD_GUIDE; break;
            case 6:
            case 7:
            default:
                Napi::RangeError::New(env, "Invalid button index").ThrowAsJavaScriptException();
                return;
        }

        // Clear the button bit (use -> for pointer)
        this->m_report->wButtons &= ~buttonMask;

        // Update the gamepad (dereference pointer with *)
        const auto result = vigem_target_x360_update(this->m_client, this->m_pad, *this->m_report);
        if (!VIGEM_SUCCESS(result)) {
            Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
            return;
        }
    
    #elif defined(IS_MACOS)
        BOOL result = [GamepadBridge buttonUp:this->m_gamepad_id button:btnIndex];
        if (!result) {
            Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
            return;
        }
        
        
    #elif defined(IS_LINUX)
        // Map button index to Linux input button codes
        int buttonCode = -1;
        switch (btnIndex) {
            case 0: buttonCode = BTN_SOUTH; break;
            case 1: buttonCode = BTN_EAST; break;
            case 2: buttonCode = BTN_NORTH; break;
            case 3: buttonCode = BTN_WEST; break;
            case 4: buttonCode = BTN_TL; break;
            case 5: buttonCode = BTN_TR; break;
            case 8: buttonCode = BTN_SELECT; break;
            case 9: buttonCode = BTN_START; break;
            case 10: buttonCode = BTN_THUMBL; break;
            case 11: buttonCode = BTN_THUMBR; break;
            case 16: buttonCode = BTN_MODE; break;
            case 12: // D-pad Up
            case 13: // D-pad Down
            case 14: // D-pad Left
            case 15: // D-pad Right
                // D-pad handled via HAT axes - release to neutral
                {
                    struct input_event ev[3];
                    memset(ev, 0, sizeof(ev));
                    
                    if (btnIndex == 12 || btnIndex == 13) { // Up/Down
                        ev[0].type = EV_ABS;
                        ev[0].code = ABS_HAT0Y;
                        ev[0].value = 0;
                    } else { // Left/Right
                        ev[0].type = EV_ABS;
                        ev[0].code = ABS_HAT0X;
                        ev[0].value = 0;
                    }
                    
                    ev[1].type = EV_SYN;
                    ev[1].code = SYN_REPORT;
                    ev[1].value = 0;
                    
                    if (write(this->m_uinput_fd, ev, sizeof(ev)) < 0) {
                        Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
                        return;
                    }
                }
                return;
            case 6:
            case 7:
            default:
                Napi::RangeError::New(env, "Invalid button index").ThrowAsJavaScriptException();
                return;
        }

        if (buttonCode >= 0) {
            struct input_event ev[2];
            memset(ev, 0, sizeof(ev));
            
            ev[0].type = EV_KEY;
            ev[0].code = buttonCode;
            ev[0].value = 0; // Release
            
            ev[1].type = EV_SYN;
            ev[1].code = SYN_REPORT;
            ev[1].value = 0;
            
            if (write(this->m_uinput_fd, ev, sizeof(ev)) < 0) {
                Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
                return;
            }
        }
    #endif
}

void Gamepad::SetAxis(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Axis index and direction expected").ThrowAsJavaScriptException();
        return;
    }
    int axisIndex = info[0].As<Napi::Number>().Int32Value();
    if (axisIndex < 0 || axisIndex > 7) {
        Napi::RangeError::New(env, "Axis index out of range (0-7)").ThrowAsJavaScriptException();
        return;
    }
    double axisValue = info[1].As<Napi::Number>().DoubleValue();
    if (axisValue < -1.0 || axisValue > 1.0) {
        Napi::RangeError::New(env, "Axis value out of range (-1.0 to 1.0)").ThrowAsJavaScriptException();
        return;
    }

    #if defined(IS_WINDOWS)
        // Convert normalized value (-1.0 to 1.0) to Xbox 360 range
        SHORT value = (SHORT)(axisValue * 32767.0);

        // Update the appropriate axis in the report (use -> for pointer)
        switch (axisIndex) {
            case 0: // Left Stick X
                this->m_report->sThumbLX = value;
                break;
            case 1: // Left Stick Y
                this->m_report->sThumbLY = -value;
                break;
            case 2: // Right Stick X
                this->m_report->sThumbRX = value;
                break;
            case 3: // Right Stick Y
                this->m_report->sThumbRY = -value;
                break;
            case 4: // Left Trigger
                // Triggers use 0-255 range
                this->m_report->bLeftTrigger = (BYTE)((axisValue + 1.0) * 127.5);
                break;
            case 5: // Right Trigger
                // Triggers use 0-255 range
                this->m_report->bRightTrigger = (BYTE)((axisValue + 1.0) * 127.5);
                break;
            default:
                Napi::RangeError::New(env, "Invalid axis index").ThrowAsJavaScriptException();
                return;
        }

        // Update the gamepad (dereference pointer with *)
        const auto result = vigem_target_x360_update(this->m_client, this->m_pad, *this->m_report);
        if (!VIGEM_SUCCESS(result)) {
            Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
            return;
        }
    #elif defined(IS_MACOS)
        // Convert normalized value (-1.0 to 1.0) to int16 range (-32768 to 32767)
        int value = (int)(axisValue * 32767.0);
        
        BOOL result = [GamepadBridge setAxis:this->m_gamepad_id axis:axisIndex value:value];
        if (!result) {
            Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
            return;
        }
        
    #elif defined(IS_LINUX)
        // Convert normalized value (-1.0 to 1.0) to appropriate range
        struct input_event ev[2];
        memset(ev, 0, sizeof(ev));
        
        ev[0].type = EV_ABS;
        
        switch (axisIndex) {
            case 0: // Left Stick X
                ev[0].code = ABS_X;
                ev[0].value = (int)(axisValue * 32767.0);
                break;
            case 1: // Left Stick Y
                ev[0].code = ABS_Y;
                ev[0].value = (int)(axisValue * 32767.0);
                break;
            case 2: // Right Stick X
                ev[0].code = ABS_RX;
                ev[0].value = (int)(axisValue * 32767.0);
                break;
            case 3: // Right Stick Y
                ev[0].code = ABS_RY;
                ev[0].value = (int)(axisValue * 32767.0);
                break;
            case 4: // Left Trigger
                ev[0].code = ABS_Z;
                ev[0].value = (int)((axisValue + 1.0) * 127.5);
                break;
            case 5: // Right Trigger
                ev[0].code = ABS_RZ;
                ev[0].value = (int)((axisValue + 1.0) * 127.5);
                break;
            default:
                Napi::RangeError::New(env, "Invalid axis index").ThrowAsJavaScriptException();
                return;
        }
        
        ev[1].type = EV_SYN;
        ev[1].code = SYN_REPORT;
        ev[1].value = 0;
        
        if (write(this->m_uinput_fd, ev, sizeof(ev)) < 0) {
            Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
            return;
        }
    #endif
}



Napi::Object Gamepad::Init(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);

    obj.Set(Napi::String::New(env, "list"), Napi::Function::New(env, Gamepad::list));
    
    // object create
    Napi::Object new_exports = Napi::Function::New(env, Gamepad::CreateObject);

    obj.Set(Napi::String::New(env, "create"), new_exports);

    Napi::Function func = DefineClass(env,
        "Gamepad",
        {
            InstanceMethod("isActive", &Gamepad::IsActive),
            InstanceMethod("destroy", &Gamepad::Destroy),
            InstanceMethod("buttonDown", &Gamepad::ButtonDown),
            InstanceMethod("buttonUp", &Gamepad::ButtonUp),
            InstanceMethod("setAxis", &Gamepad::SetAxis)
        }
    );

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    new_exports.Set("Gamepad", func);
    return obj;
}