#include "gamepad.h"
#include "args.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#if defined(IS_WINDOWS)
    #include "gamepad_win.h"
#elif defined(IS_MACOS)
    #import <Foundation/Foundation.h>
    #include "GamepadBridge.h"
#elif defined(IS_LINUX)
    #include "uinput.h"
    #include <cerrno>
    #include <poll.h>
    #include <unistd.h>
    #include <sys/eventfd.h>
    #include <sys/ioctl.h>
    #include <linux/uinput.h>
#endif


// What the addon keeps per JS environment (main thread, each worker): the
// Gamepad class and the gamepads created and not yet destroyed.
struct GamepadAddonData {
    Napi::FunctionReference constructor;
    std::vector<Napi::ObjectReference> gamepads;
};

static const int BUTTON_COUNT = 17;
static const int AXIS_COUNT = 6;


//
// rumble
//

// One onRumble listener, called on the JS thread through a thread-safe
// function. Node finalizes the function when it is released, or when the
// environment ends; from then on it must not be called. The finalizer takes
// the mutex, so it waits for a call in progress.
struct RumbleListener {
    std::mutex mutex;
    bool isAlive = true;
    Napi::ThreadSafeFunction function;
};

// Where a pad's rumble goes. The threads that learn of it (Windows: from the
// driver, Linux: from the kernel's force feedback requests) call Deliver.
struct RumbleSink {
    std::mutex mutex;
    std::shared_ptr<RumbleListener> listener;

    // strong and weak motor, 0-1
    void Deliver(double strong, double weak) {
        std::shared_ptr<RumbleListener> current;
        {
            std::lock_guard<std::mutex> lock(this->mutex);
            current = this->listener;
        }
        if (current == nullptr) {
            return;
        }
        std::lock_guard<std::mutex> lock(current->mutex);
        if (!current->isAlive) {
            return;
        }
        double* values = new double[2]{strong, weak};
        if (current->function.NonBlockingCall(values, CallListener) != napi_ok) {
            delete[] values;
        }
    }

    // takes a listener in place of the one before
    void Set(Napi::Env env, const Napi::Function& callback) {
        std::shared_ptr<RumbleListener> created = std::make_shared<RumbleListener>();
        std::weak_ptr<RumbleListener> weak = created;
        created->function = Napi::ThreadSafeFunction::New(env, callback, "easy-control rumble", 0, 1,
            [weak](Napi::Env) {
                std::shared_ptr<RumbleListener> finalized = weak.lock();
                if (finalized != nullptr) {
                    std::lock_guard<std::mutex> lock(finalized->mutex);
                    finalized->isAlive = false;
                }
            });
        // a listener does not keep the process alive
        created->function.Unref(env);
        std::shared_ptr<RumbleListener> previous;
        {
            std::lock_guard<std::mutex> lock(this->mutex);
            previous = this->listener;
            this->listener = created;
        }
        Release(previous);
    }

    void Clear() {
        std::shared_ptr<RumbleListener> previous;
        {
            std::lock_guard<std::mutex> lock(this->mutex);
            previous.swap(this->listener);
        }
        Release(previous);
    }

    static void Release(const std::shared_ptr<RumbleListener>& listener) {
        if (listener == nullptr) {
            return;
        }
        std::lock_guard<std::mutex> lock(listener->mutex);
        if (listener->isAlive) {
            listener->isAlive = false;
            listener->function.Release();
        }
    }

    static void CallListener(Napi::Env env, Napi::Function callback, double* values) {
        if (env != nullptr && callback != nullptr) {
            Napi::Object rumble = Napi::Object::New(env);
            rumble.Set("strong", values[0]);
            rumble.Set("weak", values[1]);
            callback.Call({ rumble });
        }
        delete[] values;
    }
};

#if defined(IS_WINDOWS)
// the driver's motors are 0-255, the left one the strong (low frequency) one
static void DeliverWinOutput(void* context, int leftMotor, int rightMotor) {
    static_cast<RumbleSink*>(context)->Deliver(leftMotor / 255.0, rightMotor / 255.0);
}
#endif

#if defined(IS_LINUX)
// rumble effects a game may upload at once
static const int FF_EFFECTS = 16;

static int64_t NowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

// Answers the kernel's force feedback requests for a pad until stopFd is
// written: a game's upload or erase of an effect waits for the answer. Playing
// a rumble effect, its end (by its length) and stopping it go to the sink.
static void ServeForceFeedback(int fd, int stopFd, RumbleSink* sink) {
    struct Effect {
        bool isUsed = false;
        double strong = 0;
        double weak = 0;
        int lengthMs = 0;
    };
    Effect effects[FF_EFFECTS];
    int playing = -1;
    int64_t playingUntil = 0;   // 0: until stopped

    for (;;) {
        int timeout = -1;
        if (playing >= 0 && playingUntil > 0) {
            const int64_t left = playingUntil - NowMs();
            timeout = left > 0 ? (int)left : 0;
        }
        struct pollfd fds[2] = {{fd, POLLIN, 0}, {stopFd, POLLIN, 0}};
        const int ready = poll(fds, 2, timeout);
        if (ready < 0) {
            if (errno == EINTR) {
                continue;
            }
            return;
        }
        if (fds[1].revents != 0) {
            return;
        }
        if (ready == 0) {
            // the effect has played its length
            playing = -1;
            sink->Deliver(0, 0);
            continue;
        }
        if (fds[0].revents & (POLLERR | POLLHUP | POLLNVAL)) {
            return;
        }

        struct input_event event;
        while (read(fd, &event, sizeof(event)) == (ssize_t)sizeof(event)) {
            if (event.type == EV_UINPUT && event.code == UI_FF_UPLOAD) {
                struct uinput_ff_upload upload;
                memset(&upload, 0, sizeof(upload));
                upload.request_id = event.value;
                if (ioctl(fd, UI_BEGIN_FF_UPLOAD, &upload) < 0) {
                    continue;
                }
                const int id = upload.effect.id;
                if (id >= 0 && id < FF_EFFECTS && upload.effect.type == FF_RUMBLE) {
                    effects[id].isUsed = true;
                    effects[id].strong = upload.effect.u.rumble.strong_magnitude / 65535.0;
                    effects[id].weak = upload.effect.u.rumble.weak_magnitude / 65535.0;
                    effects[id].lengthMs = upload.effect.replay.length;
                    upload.retval = 0;
                    // an update of the effect playing applies at once
                    if (playing == id) {
                        sink->Deliver(effects[id].strong, effects[id].weak);
                    }
                } else {
                    upload.retval = -EINVAL;
                }
                ioctl(fd, UI_END_FF_UPLOAD, &upload);
            } else if (event.type == EV_UINPUT && event.code == UI_FF_ERASE) {
                struct uinput_ff_erase erase;
                memset(&erase, 0, sizeof(erase));
                erase.request_id = event.value;
                if (ioctl(fd, UI_BEGIN_FF_ERASE, &erase) < 0) {
                    continue;
                }
                if (erase.effect_id < (unsigned int)FF_EFFECTS) {
                    effects[erase.effect_id].isUsed = false;
                    if (playing == (int)erase.effect_id) {
                        playing = -1;
                        sink->Deliver(0, 0);
                    }
                }
                erase.retval = 0;
                ioctl(fd, UI_END_FF_ERASE, &erase);
            } else if (event.type == EV_FF && event.code < FF_EFFECTS) {
                // value: how many times to play it, 0 to stop
                const Effect& effect = effects[event.code];
                if (event.value > 0 && effect.isUsed) {
                    playing = event.code;
                    playingUntil = effect.lengthMs > 0 ? NowMs() + (int64_t)effect.lengthMs * event.value : 0;
                    sink->Deliver(effect.strong, effect.weak);
                } else if (playing == event.code) {
                    playing = -1;
                    sink->Deliver(0, 0);
                }
            }
        }
    }
}
#endif


Napi::Value Gamepad::list(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    GamepadAddonData* data = env.GetInstanceData<GamepadAddonData>();

    Napi::Array gamepadsArr = Napi::Array::New(env);
    for (size_t i = 0; i < data->gamepads.size(); i++) {
        gamepadsArr.Set((uint32_t)i, data->gamepads[i].Value());
    }
    return gamepadsArr;
}

// What plugging in a gamepad gives: the platform's handle to it.
struct PadHandle {
    #if defined(IS_WINDOWS)
        WinPad* pad = nullptr;
    #elif defined(IS_MACOS)
        int gamepadId = -1;
    #elif defined(IS_LINUX)
        int fd = -1;
    #endif
};

// Plugs in a virtual gamepad; false, with a message and an error code, when
// it cannot. Runs off the JS thread, so it touches no JS value.
static bool OpenPad(PadHandle& handle, std::string& message, std::string& code) {
    code = "EASYCONTROL_CREATE_FAILED";
    #if defined(IS_WINDOWS)
        WinPadError error;
        handle.pad = WinPadCreate(error);
        if (handle.pad == nullptr) {
            message = error.message;
            code = error.code;
            return false;
        }
        return true;

    #elif defined(IS_MACOS)
        // it waits for the gamepad's activation, at most 5 s
        handle.gamepadId = [GamepadBridge createGamepad];
        if (handle.gamepadId == -3) {
            message = "The virtual gamepad was made, but its activation did not finish within 5 s";
            return false;
        }
        if (handle.gamepadId < 0) {
            message = "Failed to create the virtual gamepad (needs macOS 15 and the com.apple.developer.hid.virtual.device entitlement)";
            return false;
        }
        return true;

    #elif defined(IS_LINUX)
        // read too: games' rumble comes as force feedback requests
        int fd = OpenUinput(message, true);
        if (fd < 0) {
            return false;
        }

        // Enable event types
        if (ioctl(fd, UI_SET_EVBIT, EV_KEY) < 0 ||
            ioctl(fd, UI_SET_EVBIT, EV_ABS) < 0 ||
            ioctl(fd, UI_SET_EVBIT, EV_FF) < 0 ||
            ioctl(fd, UI_SET_FFBIT, FF_RUMBLE) < 0) {
            message = std::string("Failed to set up the virtual gamepad: ") + strerror(errno);
            close(fd);
            return false;
        }

        // Enable buttons (BTN_GAMEPAD + standard Xbox buttons)
        ioctl(fd, UI_SET_KEYBIT, BTN_SOUTH);      // A
        ioctl(fd, UI_SET_KEYBIT, BTN_EAST);       // B
        ioctl(fd, UI_SET_KEYBIT, BTN_NORTH);      // X
        ioctl(fd, UI_SET_KEYBIT, BTN_WEST);       // Y
        ioctl(fd, UI_SET_KEYBIT, BTN_TL);         // LB
        ioctl(fd, UI_SET_KEYBIT, BTN_TR);         // RB
        ioctl(fd, UI_SET_KEYBIT, BTN_SELECT);     // Back
        ioctl(fd, UI_SET_KEYBIT, BTN_START);      // Start
        ioctl(fd, UI_SET_KEYBIT, BTN_MODE);       // Guide
        ioctl(fd, UI_SET_KEYBIT, BTN_THUMBL);     // Left Stick
        ioctl(fd, UI_SET_KEYBIT, BTN_THUMBR);     // Right Stick

        // Enable axes
        ioctl(fd, UI_SET_ABSBIT, ABS_X);          // Left stick X
        ioctl(fd, UI_SET_ABSBIT, ABS_Y);          // Left stick Y
        ioctl(fd, UI_SET_ABSBIT, ABS_RX);         // Right stick X
        ioctl(fd, UI_SET_ABSBIT, ABS_RY);         // Right stick Y
        ioctl(fd, UI_SET_ABSBIT, ABS_Z);          // Left trigger
        ioctl(fd, UI_SET_ABSBIT, ABS_RZ);         // Right trigger
        ioctl(fd, UI_SET_ABSBIT, ABS_HAT0X);      // D-pad X
        ioctl(fd, UI_SET_ABSBIT, ABS_HAT0Y);      // D-pad Y

        // Setup device
        struct uinput_setup usetup;
        memset(&usetup, 0, sizeof(usetup));
        usetup.id.bustype = BUS_USB;
        usetup.id.vendor = 0x045e;  // Microsoft
        usetup.id.product = 0x028e; // Xbox 360 Controller
        usetup.id.version = 1;
        strncpy(usetup.name, "Virtual Xbox 360 Controller", UINPUT_MAX_NAME_SIZE - 1);
        usetup.ff_effects_max = FF_EFFECTS;

        // Configure axis ranges
        struct uinput_abs_setup abs_setup;
        memset(&abs_setup, 0, sizeof(abs_setup));

        // Sticks
        abs_setup.absinfo.minimum = -32768;
        abs_setup.absinfo.maximum = 32767;
        abs_setup.absinfo.value = 0;
        const unsigned short sticks[] = {ABS_X, ABS_Y, ABS_RX, ABS_RY};
        for (unsigned short stick : sticks) {
            abs_setup.code = stick;
            ioctl(fd, UI_ABS_SETUP, &abs_setup);
        }

        // Triggers (0-255)
        abs_setup.absinfo.minimum = 0;
        abs_setup.absinfo.maximum = 255;
        abs_setup.code = ABS_Z;
        ioctl(fd, UI_ABS_SETUP, &abs_setup);
        abs_setup.code = ABS_RZ;
        ioctl(fd, UI_ABS_SETUP, &abs_setup);

        // D-pad (-1, 0, 1)
        abs_setup.absinfo.minimum = -1;
        abs_setup.absinfo.maximum = 1;
        abs_setup.code = ABS_HAT0X;
        ioctl(fd, UI_ABS_SETUP, &abs_setup);
        abs_setup.code = ABS_HAT0Y;
        ioctl(fd, UI_ABS_SETUP, &abs_setup);

        if (ioctl(fd, UI_DEV_SETUP, &usetup) < 0 ||
            ioctl(fd, UI_DEV_CREATE) < 0) {
            message = std::string("Failed to create the virtual gamepad: ") + strerror(errno);
            close(fd);
            return false;
        }
        // Applications open the new device only once udev has announced it,
        // and miss what is sent before; this runs off the JS thread, so the
        // wait costs the app nothing (the mouse and keyboard wait as long)
        usleep(200000);
        handle.fd = fd;
        return true;
    #endif
}

// Unplugs a gamepad that never got its JS object.
static void ClosePad(PadHandle& handle) {
    #if defined(IS_WINDOWS)
        WinPadDestroy(handle.pad);
        handle.pad = nullptr;
    #elif defined(IS_MACOS)
        if (handle.gamepadId >= 0) {
            [GamepadBridge destroyGamepad:handle.gamepadId];
            handle.gamepadId = -1;
        }
    #elif defined(IS_LINUX)
        if (handle.fd >= 0) {
            ioctl(handle.fd, UI_DEV_DESTROY);
            close(handle.fd);
            handle.fd = -1;
        }
    #endif
}

// plugs a gamepad in off the JS thread (on Windows that starts the service
// and waits for the devices) and resolves with its object
class CreatePadWorker : public Napi::AsyncWorker {
    public:
        explicit CreatePadWorker(Napi::Env env)
            : Napi::AsyncWorker(env), m_deferred(Napi::Promise::Deferred::New(env)) {}

        Napi::Promise Promise() {
            return this->m_deferred.Promise();
        }

        void Execute() override {
            this->m_isOpen = OpenPad(this->m_handle, this->m_message, this->m_code);
        }

        void OnOK() override {
            Napi::Env env = this->Env();
            if (!this->m_isOpen) {
                Napi::Error error = Napi::Error::New(env, this->m_message);
                error.Set("code", Napi::String::New(env, this->m_code));
                this->m_deferred.Reject(error.Value());
                return;
            }
            // the object takes the handle over
            GamepadAddonData* data = env.GetInstanceData<GamepadAddonData>();
            Napi::Object gamepad = data->constructor.New({ Napi::External<PadHandle>::New(env, &this->m_handle) });
            if (env.IsExceptionPending()) {
                const Napi::Error error = env.GetAndClearPendingException();
                ClosePad(this->m_handle);
                this->m_deferred.Reject(error.Value());
                return;
            }
            data->gamepads.push_back(Napi::Persistent(gamepad));
            this->m_deferred.Resolve(gamepad);
        }

    private:
        Napi::Promise::Deferred m_deferred;
        PadHandle m_handle;
        bool m_isOpen = false;
        std::string m_message;
        std::string m_code;
};

// Gamepad.create(): a Promise of a new virtual gamepad; rejects with an Error
// saying why, and a code (EASYCONTROL_DRIVER_MISSING, ...), when it cannot
Napi::Value Gamepad::CreateObject(const Napi::CallbackInfo& info) {
    CreatePadWorker* worker = new CreatePadWorker(info.Env());
    Napi::Promise promise = worker->Promise();
    worker->Queue();
    return promise;
}

// made only by Gamepad.create(), which hands over the plugged-in gamepad
Gamepad::Gamepad(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Gamepad>(info) {
    Napi::Env env = info.Env();
    this->m_rumble.reset(new RumbleSink());
    if (info.Length() < 1 || !info[0].IsExternal()) {
        Napi::TypeError::New(env, "Use Gamepad.create() to make a gamepad").ThrowAsJavaScriptException();
        return;
    }
    PadHandle* handle = info[0].As<Napi::External<PadHandle>>().Data();
    #if defined(IS_WINDOWS)
        this->m_pad = handle->pad;
        handle->pad = nullptr;
    #elif defined(IS_MACOS)
        this->m_gamepad_id = handle->gamepadId;
        handle->gamepadId = -1;
    #elif defined(IS_LINUX)
        this->m_uinput_fd = handle->fd;
        handle->fd = -1;
        this->m_stopFd = eventfd(0, EFD_CLOEXEC);
        if (this->m_stopFd >= 0) {
            this->m_ffThread = std::thread(ServeForceFeedback, this->m_uinput_fd, this->m_stopFd, this->m_rumble.get());
        }
    #endif
    this->m_active = true;
}

Gamepad::~Gamepad() {
    this->Release();
}

void Gamepad::Release() {
    this->m_active = false;
    #if defined(IS_WINDOWS)
        // stops its rumble thread first
        WinPadDestroy(this->m_pad);
        this->m_pad = nullptr;
    #elif defined(IS_MACOS)
        if (this->m_gamepad_id >= 0) {
            [GamepadBridge destroyGamepad:this->m_gamepad_id];
            this->m_gamepad_id = -1;
        }
    #elif defined(IS_LINUX)
        if (this->m_ffThread.joinable()) {
            const uint64_t one = 1;
            if (write(this->m_stopFd, &one, sizeof(one)) == (ssize_t)sizeof(one)) {
                this->m_ffThread.join();
            } else {
                this->m_ffThread.detach();
            }
        }
        if (this->m_stopFd >= 0) {
            close(this->m_stopFd);
            this->m_stopFd = -1;
        }
        if (this->m_uinput_fd >= 0) {
            ioctl(this->m_uinput_fd, UI_DEV_DESTROY);
            close(this->m_uinput_fd);
            this->m_uinput_fd = -1;
        }
        this->m_dpad = 0;
    #endif
    if (this->m_rumble != nullptr) {
        this->m_rumble->Clear();
    }
}

bool Gamepad::RequireActive(Napi::Env env) {
    if (!this->m_active) {
        Napi::Error::New(env, "Gamepad is not active").ThrowAsJavaScriptException();
        return false;
    }
    return true;
}

Napi::Value Gamepad::IsActive(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, this->m_active);
}

void Gamepad::Destroy(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object thisObj = info.This().As<Napi::Object>();

    // unplug it now; the object itself is freed when JS lets go of it
    this->Release();
    this->m_onRumble.Reset();

    // Find and remove from the gamepads list
    GamepadAddonData* data = env.GetInstanceData<GamepadAddonData>();
    for (auto it = data->gamepads.begin(); it != data->gamepads.end(); ++it) {
        if (it->Value() == thisObj) {
            it->Reset();  // Release the persistent reference
            data->gamepads.erase(it);
            break;
        }
    }
}

#if defined(IS_LINUX)
// the event of a button change; the D-pad's directions and the triggers are axes
void Gamepad::AddButton(std::vector<struct input_event>& events, int button, bool isDown) {
    struct input_event event;
    memset(&event, 0, sizeof(event));
    if (button >= 12 && button <= 15) {
        // the D-pad is a hat: each axis is the net of the directions held
        const uint8_t bit = (uint8_t)(1u << (button - 12));
        if (isDown) {
            this->m_dpad |= bit;
        } else {
            this->m_dpad &= (uint8_t)~bit;
        }
        const bool isVertical = (button <= 13);
        event.type = EV_ABS;
        event.code = isVertical ? ABS_HAT0Y : ABS_HAT0X;
        event.value = isVertical
            ? ((this->m_dpad & 0x2) ? 1 : 0) - ((this->m_dpad & 0x1) ? 1 : 0)
            : ((this->m_dpad & 0x8) ? 1 : 0) - ((this->m_dpad & 0x4) ? 1 : 0);
    } else if (button == 6 || button == 7) {
        // the triggers are axes: fully pulled or released
        event.type = EV_ABS;
        event.code = button == 6 ? ABS_Z : ABS_RZ;
        event.value = isDown ? 255 : 0;
    } else {
        unsigned short buttonCode = BTN_SOUTH;
        switch (button) {
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
        }
        event.type = EV_KEY;
        event.code = buttonCode;
        event.value = isDown ? 1 : 0;
    }
    events.push_back(event);
}

void Gamepad::AddAxis(std::vector<struct input_event>& events, int axis, double value) {
    struct input_event event;
    memset(&event, 0, sizeof(event));
    event.type = EV_ABS;
    switch (axis) {
        case 0: event.code = ABS_X;  event.value = (int)(value * 32767.0); break;  // Left Stick X
        case 1: event.code = ABS_Y;  event.value = (int)(value * 32767.0); break;  // Left Stick Y
        case 2: event.code = ABS_RX; event.value = (int)(value * 32767.0); break;  // Right Stick X
        case 3: event.code = ABS_RY; event.value = (int)(value * 32767.0); break;  // Right Stick Y
        case 4: event.code = ABS_Z;  event.value = (int)((value + 1.0) * 127.5); break;  // Left Trigger
        case 5: event.code = ABS_RZ; event.value = (int)((value + 1.0) * 127.5); break;  // Right Trigger
    }
    events.push_back(event);
}

bool Gamepad::WriteEvents(std::vector<struct input_event>& events) {
    struct input_event report;
    memset(&report, 0, sizeof(report));
    report.type = EV_SYN;
    report.code = SYN_REPORT;
    events.push_back(report);
    const ssize_t size = (ssize_t)(events.size() * sizeof(struct input_event));
    return write(this->m_uinput_fd, events.data(), size) == size;
}
#endif

void Gamepad::SetButton(const Napi::CallbackInfo& info, bool isDown) {
    Napi::Env env = info.Env();

    if (!this->RequireActive(env)) {
        return;
    }

    int btnIndex = 0;
    if (!RequireIndex(info, 0, BUTTON_COUNT, "Button index out of range (0-16)", btnIndex)) {
        return;
    }

    bool isWritten = true;
    #if defined(IS_WINDOWS)
        isWritten = WinPadSetButton(this->m_pad, btnIndex, isDown);
    #elif defined(IS_MACOS)
        isWritten = isDown
            ? [GamepadBridge buttonDown:this->m_gamepad_id button:btnIndex]
            : [GamepadBridge buttonUp:this->m_gamepad_id button:btnIndex];
    #elif defined(IS_LINUX)
        std::vector<struct input_event> events;
        this->AddButton(events, btnIndex, isDown);
        isWritten = this->WriteEvents(events);
    #endif
    if (!isWritten) {
        Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
    }
}

void Gamepad::ButtonDown(const Napi::CallbackInfo& info) {
    this->SetButton(info, true);
}

void Gamepad::ButtonUp(const Napi::CallbackInfo& info) {
    this->SetButton(info, false);
}

void Gamepad::SetAxis(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!this->RequireActive(env)) {
        return;
    }

    int axisIndex = 0;
    if (!RequireArgs(info, 2) || !RequireIndex(info, 0, AXIS_COUNT, "Axis index out of range (0-5)", axisIndex)) {
        return;
    }
    if (!info[1].IsNumber()) {
        Napi::TypeError::New(env, "Argument 2 must be a number").ThrowAsJavaScriptException();
        return;
    }
    double axisValue = info[1].As<Napi::Number>().DoubleValue();
    if (!std::isfinite(axisValue) || axisValue < -1.0 || axisValue > 1.0) {
        Napi::RangeError::New(env, "Axis value out of range (-1.0 to 1.0)").ThrowAsJavaScriptException();
        return;
    }

    bool isWritten = true;
    #if defined(IS_WINDOWS)
        isWritten = WinPadSetAxis(this->m_pad, axisIndex, axisValue);
    #elif defined(IS_MACOS)
        // Convert normalized value (-1.0 to 1.0) to int16 range (-32768 to 32767)
        isWritten = [GamepadBridge setAxis:this->m_gamepad_id axis:axisIndex value:(int)(axisValue * 32767.0)];
    #elif defined(IS_LINUX)
        std::vector<struct input_event> events;
        this->AddAxis(events, axisIndex, axisValue);
        isWritten = this->WriteEvents(events);
    #endif
    if (!isWritten) {
        Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
    }
}


// one button of a setState call: pressed, and how far (the triggers are analog)
struct ButtonChange {
    int index;
    bool isPressed;
    double value;
};

// reads setState's buttons: booleans, numbers 0-1, or { pressed, value } like
// a browser's GamepadButton; null and undefined entries keep their button
static bool ParseButtons(Napi::Env env, const Napi::Value& value, std::vector<ButtonChange>& changes) {
    if (value.IsUndefined() || value.IsNull()) {
        return true;
    }
    if (!value.IsArray()) {
        Napi::TypeError::New(env, "buttons must be an array").ThrowAsJavaScriptException();
        return false;
    }
    const Napi::Array buttons = value.As<Napi::Array>();
    const uint32_t count = buttons.Length() < (uint32_t)BUTTON_COUNT ? buttons.Length() : (uint32_t)BUTTON_COUNT;
    for (uint32_t i = 0; i < count; i++) {
        const Napi::Value button = buttons.Get(i);
        ButtonChange change = { (int)i, false, 0 };
        if (button.IsUndefined() || button.IsNull()) {
            continue;
        } else if (button.IsBoolean()) {
            change.isPressed = button.As<Napi::Boolean>().Value();
            change.value = change.isPressed ? 1 : 0;
        } else if (button.IsNumber()) {
            change.value = button.As<Napi::Number>().DoubleValue();
            change.isPressed = change.value >= 0.5;
        } else if (button.IsObject()) {
            const Napi::Object object = button.As<Napi::Object>();
            const Napi::Value pressed = object.Get("pressed");
            const Napi::Value amount = object.Get("value");
            if (amount.IsNumber()) {
                change.value = amount.As<Napi::Number>().DoubleValue();
            }
            change.isPressed = pressed.IsBoolean() ? pressed.As<Napi::Boolean>().Value() : change.value >= 0.5;
            if (!amount.IsNumber()) {
                change.value = change.isPressed ? 1 : 0;
            }
        } else {
            Napi::TypeError::New(env, "buttons[" + std::to_string(i) + "] must be a boolean, a number or { pressed, value }")
                .ThrowAsJavaScriptException();
            return false;
        }
        if (!std::isfinite(change.value) || change.value < 0 || change.value > 1) {
            Napi::RangeError::New(env, "buttons[" + std::to_string(i) + "] value out of range (0 to 1)").ThrowAsJavaScriptException();
            return false;
        }
        changes.push_back(change);
    }
    return true;
}

// reads setState's axes: numbers -1..1; null and undefined keep their axis
static bool ParseAxes(Napi::Env env, const Napi::Value& value, std::vector<std::pair<int, double>>& changes) {
    if (value.IsUndefined() || value.IsNull()) {
        return true;
    }
    if (!value.IsArray()) {
        Napi::TypeError::New(env, "axes must be an array").ThrowAsJavaScriptException();
        return false;
    }
    const Napi::Array axes = value.As<Napi::Array>();
    const uint32_t count = axes.Length() < (uint32_t)AXIS_COUNT ? axes.Length() : (uint32_t)AXIS_COUNT;
    for (uint32_t i = 0; i < count; i++) {
        const Napi::Value axis = axes.Get(i);
        if (axis.IsUndefined() || axis.IsNull()) {
            continue;
        }
        if (!axis.IsNumber()) {
            Napi::TypeError::New(env, "axes[" + std::to_string(i) + "] must be a number").ThrowAsJavaScriptException();
            return false;
        }
        const double number = axis.As<Napi::Number>().DoubleValue();
        if (!std::isfinite(number) || number < -1 || number > 1) {
            Napi::RangeError::New(env, "axes[" + std::to_string(i) + "] out of range (-1.0 to 1.0)").ThrowAsJavaScriptException();
            return false;
        }
        changes.push_back(std::make_pair((int)i, number));
    }
    return true;
}

// gamepad.setState({ buttons, axes }): many changes in one report, so a
// browser gamepad can be passed through as it is, once per frame. Buttons 6
// and 7 (the triggers) take their analog value; axes 4 and 5 drive the same
// triggers and, coming after the buttons, win. Entries past 17 buttons and 6
// axes are ignored.
void Gamepad::SetState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!this->RequireActive(env)) {
        return;
    }
    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected a state object: { buttons, axes }").ThrowAsJavaScriptException();
        return;
    }
    const Napi::Object state = info[0].As<Napi::Object>();
    std::vector<ButtonChange> buttons;
    std::vector<std::pair<int, double>> axes;
    // every argument is checked before anything changes
    if (!ParseButtons(env, state.Get("buttons"), buttons) || !ParseAxes(env, state.Get("axes"), axes)) {
        return;
    }
    if (buttons.empty() && axes.empty()) {
        return;
    }

    bool isWritten = true;
    #if defined(IS_WINDOWS)
        for (const ButtonChange& button : buttons) {
            if (button.index == 6 || button.index == 7) {
                WinPadSetAxis(this->m_pad, button.index - 2, button.value * 2 - 1, false);
            } else {
                WinPadSetButton(this->m_pad, button.index, button.isPressed, false);
            }
        }
        for (const auto& axis : axes) {
            WinPadSetAxis(this->m_pad, axis.first, axis.second, false);
        }
        isWritten = WinPadSend(this->m_pad);

    #elif defined(IS_MACOS)
        const int padId = this->m_gamepad_id;
        [GamepadBridge beginUpdate:padId];
        for (const ButtonChange& button : buttons) {
            if (button.index == 6 || button.index == 7) {
                // its analog value and its pressed state, each as given
                [GamepadBridge setTrigger:padId button:button.index value:(int)((button.value * 2 - 1) * 32767.0) pressed:button.isPressed];
            } else if (button.isPressed) {
                [GamepadBridge buttonDown:padId button:button.index];
            } else {
                [GamepadBridge buttonUp:padId button:button.index];
            }
        }
        for (const auto& axis : axes) {
            [GamepadBridge setAxis:padId axis:axis.first value:(int)(axis.second * 32767.0)];
        }
        isWritten = [GamepadBridge endUpdate:padId];

    #elif defined(IS_LINUX)
        std::vector<struct input_event> events;
        for (const ButtonChange& button : buttons) {
            if (button.index == 6 || button.index == 7) {
                this->AddAxis(events, button.index - 2, button.value * 2 - 1);
            } else {
                this->AddButton(events, button.index, button.isPressed);
            }
        }
        for (const auto& axis : axes) {
            this->AddAxis(events, axis.first, axis.second);
        }
        isWritten = this->WriteEvents(events);
    #endif
    if (!isWritten) {
        Napi::Error::New(env, "Failed to update gamepad state").ThrowAsJavaScriptException();
    }
}


// gamepad.onRumble: called with { strong, weak } (0-1 each) when a game sets
// the rumble motors, { 0, 0 } when it stops; null for none. macOS: never
// called (the CoreHID gamepad has no rumble games use).
Napi::Value Gamepad::GetOnRumble(const Napi::CallbackInfo& info) {
    return this->m_onRumble.IsEmpty() ? info.Env().Null() : this->m_onRumble.Value();
}

void Gamepad::SetOnRumble(const Napi::CallbackInfo& info, const Napi::Value& value) {
    Napi::Env env = info.Env();
    if (value.IsNull() || value.IsUndefined()) {
        #if defined(IS_WINDOWS)
            if (this->m_pad != nullptr) {
                WinPadStopOutput(this->m_pad);
            }
        #endif
        this->m_rumble->Clear();
        this->m_onRumble.Reset();
        return;
    }
    if (!value.IsFunction()) {
        Napi::TypeError::New(env, "onRumble must be a function or null").ThrowAsJavaScriptException();
        return;
    }
    if (!this->RequireActive(env)) {
        return;
    }
    const bool hadListener = !this->m_onRumble.IsEmpty();
    this->m_onRumble = Napi::Persistent(value.As<Napi::Function>());
    this->m_rumble->Set(env, value.As<Napi::Function>());
    #if defined(IS_WINDOWS)
        // the driver is asked only while someone listens
        if (!hadListener) {
            WinPadStartOutput(this->m_pad, DeliverWinOutput, this->m_rumble.get());
        }
    #else
        (void)hadListener;
    #endif
}


// Gamepad.getDriverStatus(): { isInstalled, version, required, available,
// isOutdated, isUpdateAvailable }. Only Windows needs a driver installed;
// elsewhere it reports one is.
Napi::Value Gamepad::GetDriverStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    #if defined(IS_WINDOWS)
        const WinDriverStatus status = WinDriverGetStatus();
        result.Set("isInstalled", status.isInstalled);
        result.Set("version", status.isInstalled ? Napi::Value(Napi::Number::New(env, status.version)) : env.Null());
        result.Set("required", status.required);
        result.Set("available", status.available > 0 ? Napi::Value(Napi::Number::New(env, status.available)) : env.Null());
        result.Set("isOutdated", status.isInstalled && status.version < status.required);
        result.Set("isUpdateAvailable", status.isInstalled && status.available > 0 && status.version < status.available);
    #else
        result.Set("isInstalled", true);
        result.Set("version", env.Null());
        result.Set("required", env.Null());
        result.Set("available", env.Null());
        result.Set("isOutdated", false);
        result.Set("isUpdateAvailable", false);
    #endif
    return result;
}

#if defined(IS_WINDOWS)
// runs the driver setup off the JS thread: it waits for the UAC prompt
class DriverSetupWorker : public Napi::AsyncWorker {
    public:
        DriverSetupWorker(Napi::Env env, const wchar_t* action, bool force)
            : Napi::AsyncWorker(env), m_action(action), m_force(force), m_deferred(Napi::Promise::Deferred::New(env)) {}

        Napi::Promise Promise() {
            return this->m_deferred.Promise();
        }

        void Execute() override {
            this->m_isDone = WinDriverRunSetup(this->m_action, this->m_force, this->m_error);
        }

        void OnOK() override {
            Napi::Env env = this->Env();
            if (this->m_isDone) {
                this->m_deferred.Resolve(env.Undefined());
                return;
            }
            Napi::Error error = Napi::Error::New(env, this->m_error.message);
            error.Set("code", Napi::String::New(env, this->m_error.code));
            this->m_deferred.Reject(error.Value());
        }

    private:
        const wchar_t* m_action;
        bool m_force;
        Napi::Promise::Deferred m_deferred;
        bool m_isDone = false;
        WinPadError m_error;
};
#endif

static Napi::Value ResolvedPromise(Napi::Env env) {
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    deferred.Resolve(env.Undefined());
    return deferred.Promise();
}

static Napi::Value RunDriverSetup(const Napi::CallbackInfo& info, const wchar_t* action, bool force) {
    Napi::Env env = info.Env();
    #if defined(IS_WINDOWS)
        DriverSetupWorker* worker = new DriverSetupWorker(env, action, force);
        Napi::Promise promise = worker->Promise();
        worker->Queue();
        return promise;
    #else
        (void)action;
        (void)force;
        return ResolvedPromise(env);
    #endif
}

// Gamepad.installDriver({ force }): installs or updates the driver, behind one
// UAC prompt. It does not replace a newer installed driver, which serves this
// version too (resolving at once, without a prompt), unless force is true.
Napi::Value Gamepad::InstallDriver(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    bool force = false;
    if (info.Length() > 0 && !info[0].IsUndefined() && !info[0].IsNull()) {
        if (!info[0].IsObject()) {
            Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
            deferred.Reject(Napi::TypeError::New(env, "Expected an options object: { force }").Value());
            return deferred.Promise();
        }
        force = info[0].As<Napi::Object>().Get("force").ToBoolean().Value();
    }
    #if defined(IS_WINDOWS)
        const WinDriverStatus status = WinDriverGetStatus();
        if (!force && status.isInstalled && status.available > 0 && status.version > status.available) {
            return ResolvedPromise(env);
        }
    #endif
    return RunDriverSetup(info, L"install", force);
}

// Gamepad.uninstallDriver(): removes it again, behind one UAC prompt
Napi::Value Gamepad::UninstallDriver(const Napi::CallbackInfo& info) {
    return RunDriverSetup(info, L"uninstall", false);
}


Napi::Object Gamepad::Init(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);

    SetFunction(env, obj, "list", Gamepad::list);
    SetFunction(env, obj, "getDriverStatus", Gamepad::GetDriverStatus);
    SetFunction(env, obj, "installDriver", Gamepad::InstallDriver);
    SetFunction(env, obj, "uninstallDriver", Gamepad::UninstallDriver);

    // object create
    Napi::Function create = SetFunction(env, obj, "create", Gamepad::CreateObject);

    Napi::Function func = DefineClass(env,
        "Gamepad",
        {
            InstanceMethod("isActive", &Gamepad::IsActive),
            InstanceMethod("destroy", &Gamepad::Destroy),
            InstanceMethod("buttonDown", &Gamepad::ButtonDown),
            InstanceMethod("buttonUp", &Gamepad::ButtonUp),
            InstanceMethod("setAxis", &Gamepad::SetAxis),
            InstanceMethod("setState", &Gamepad::SetState),
            InstanceAccessor("onRumble", &Gamepad::GetOnRumble, &Gamepad::SetOnRumble)
        }
    );

    GamepadAddonData* data = new GamepadAddonData();
    data->constructor = Napi::Persistent(func);
    env.SetInstanceData(data);

    create.Set("Gamepad", func);
    return obj;
}
