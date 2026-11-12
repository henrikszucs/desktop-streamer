#pragma once
#ifndef PLATFORM_H
#define PLATFORM_H

// Helpers the modules share, one set per platform.

#include "input_error.h"

#include <napi.h>
#include <string>

// Throws a failed send as an Error, with its code when it has one.
inline void ThrowInputError(Napi::Env env, const InputError& inputError) {
    Napi::Error error = Napi::Error::New(env, inputError.message);
    if (!inputError.code.empty()) {
        error.Set("code", Napi::String::New(env, inputError.code));
    }
    error.ThrowAsJavaScriptException();
}

#if defined(IS_WINDOWS)
    #ifndef WIN32_LEAN_AND_MEAN
        #define WIN32_LEAN_AND_MEAN 1
    #endif
    #include <windows.h>
    #include <cstdio>
    #include <vector>

    // The error of input Windows did not take (SendInput sending nothing, the
    // pointer not to be read or set): the secure desktop - a UAC prompt, the
    // lock or sign-in screen - is showing, or input is otherwise not this
    // process's to send. UIPI drops are not reported this way;
    // Platform.getInputBlock() tells about those.
    inline InputError InputBlockedError(const std::string& what) {
        return InputError{ "EASYCONTROL_INPUT_BLOCKED", "Windows did not take the input (" + what +
            "); the secure desktop (a UAC prompt, the lock screen) may be showing, see Platform.getInputBlock()" };
    }

    inline void ThrowInputBlocked(Napi::Env env, const std::string& what) {
        ThrowInputError(env, InputBlockedError(what));
    }

    // a Windows error code as text, with the code: "Access is denied (0x00000005)"
    inline std::string WinErrorText(DWORD code) {
        char* text = nullptr;
        FormatMessageA(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
            nullptr, code, MAKELANGID(LANG_ENGLISH, SUBLANG_ENGLISH_US), (LPSTR)&text, 0, nullptr);
        std::string result = text != nullptr ? text : "";
        LocalFree(text);
        while (!result.empty() && (result.back() == '\n' || result.back() == '\r' || result.back() == ' ' || result.back() == '.')) {
            result.pop_back();
        }
        char number[16];
        snprintf(number, sizeof(number), " (0x%08X)", (unsigned)code);
        return result + number;
    }

    // UTF-8 -> UTF-16
    inline std::wstring WidenUtf8(const std::string& text) {
        const int size = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.length(), nullptr, 0);
        std::wstring wide(size > 0 ? size : 0, L'\0');
        if (size > 0) {
            MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.length(), &wide[0], size);
        }
        return wide;
    }

    // Runs the enclosed Win32 calls per-monitor DPI aware, so every coordinate
    // they take or return is in physical pixels, whatever DPI awareness the
    // host process (node.exe, Electron, ...) was started with.
    // SetThreadDpiAwarenessContext (Windows 10 1607+) is looked up at run time,
    // so neither the SDK's WINVER nor an older Windows stops the addon loading.
    class DpiScope {
        public:
            DpiScope() {
                SetContextFn setContext = SetContext();
                if (setContext != nullptr) {
                    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
                    m_previous = setContext((HANDLE)(LONG_PTR)-4);
                }
            }
            ~DpiScope() {
                if (m_previous != NULL) {
                    SetContext()(m_previous);
                }
            }
            DpiScope(const DpiScope&) = delete;
            DpiScope& operator=(const DpiScope&) = delete;
        private:
            typedef HANDLE (WINAPI *SetContextFn)(HANDLE);
            static SetContextFn SetContext() {
                static SetContextFn fn = (SetContextFn)GetProcAddress(GetModuleHandleW(L"user32.dll"), "SetThreadDpiAwarenessContext");
                return fn;
            }
            HANDLE m_previous = NULL;
    };

    // A monitor in physical pixels, with its scale (effective DPI / 96).
    // The logical coordinate space easy-control reports is each monitor's
    // physical rectangle divided by that monitor's own scale.
    struct MonitorLayout {
        RECT rect;
        std::wstring device;    // the GDI device name, "\\.\DISPLAY1"
        double scaleFactor;
        bool isPrimary;
    };

    // A monitor's place in the logical coordinate space: its physical
    // rectangle and scale, and its logical origin and size.
    struct LogicalMonitor {
        MonitorLayout layout;
        LONG x;
        LONG y;
        LONG width;
        LONG height;
    };

    // every monitor, laid out in logical pixels as Electron's screen API does
    // (defined in screen.cpp); call it inside a DpiScope. It asks each monitor
    // its DPI, so a call makes it once and passes it on.
    std::vector<LogicalMonitor> LayoutMonitors();

    // physical pixel -> logical coordinate, and back, in a layout from
    // LayoutMonitors (defined in screen.cpp)
    void PhysicalToLogical(const std::vector<LogicalMonitor>& monitors, POINT point, double& x, double& y);
    POINT LogicalToPhysical(const std::vector<LogicalMonitor>& monitors, double x, double y);

#elif defined(IS_MACOS)
    #include <ApplicationServices/ApplicationServices.h>
    #include <mutex>

    // One event source for every synthesized event, sharing the HID system's
    // state, so the events look like they come from the same device.
    // The pointer warps easy-control makes do not hold back the real mouse.
    inline CGEventSourceRef EventSource() {
        static CGEventSourceRef source = [] {
            CGEventSourceRef created = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
            if (created != NULL) {
                CGEventSourceSetLocalEventsSuppressionInterval(created, 0.0);
            }
            return created;
        }();
        return source;
    }

    // What the keyboard and the mouse keep between calls - the modifiers and
    // Caps Lock held through keyDown (keyboard.cpp), the buttons held, the
    // last press for the click count (mouse.cpp) - is shared by every thread
    // the addon is used from (workers too): it is read and written holding
    // InputStateLock, for as long as an event is being made from it. It is
    // recursive: a step may call a helper that takes it too.
    inline std::recursive_mutex& InputStateMutex() {
        static std::recursive_mutex mutex;
        return mutex;
    }

    struct InputStateLock {
        std::lock_guard<std::recursive_mutex> guard{InputStateMutex()};
    };

    // Modifier keys held down through Keyboard.keyDown. Events made with
    // CGEventCreate* do not pick them up by themselves, so every keyboard and
    // mouse event gets them set. Use it holding an InputStateLock.
    inline CGEventFlags& ModifierFlags() {
        static CGEventFlags flags = 0;
        return flags;
    }

    // Mouse buttons held down through Mouse.buttonDown (bit = CGMouseButton),
    // so a move while one is held is posted as a drag. Use it holding an
    // InputStateLock.
    inline uint32_t& PressedButtons() {
        static uint32_t buttons = 0;
        return buttons;
    }

#elif defined(IS_LINUX)
    #include <X11/Xlib.h>
    #include <mutex>
    #include <string>
    #include <vector>

    // A screen in the coordinates Mouse and Screen use: the compositor's
    // logical ones on Wayland, X11 pixels otherwise.
    struct ScreenRect {
        int x;
        int y;
        int width;
        int height;
        double scaleFactor;
        bool isPrimary;
        std::string id;     // the output name ("HDMI-1", ...)
        std::string name;   // the monitor name for people, "" when unknown
    };

    // every screen; from the Wayland compositor in a Wayland session (when it
    // can be asked), from XRandR otherwise (defined in screen.cpp)
    std::vector<ScreenRect> ListScreens();

    // The X11 connection is shared by every thread the addon is used from
    // (workers too), and Xlib is not safe for two threads at once unless
    // XInitThreads ran before any other Xlib call of the process - too late
    // for an addon, whose host may have used Xlib already. So every use of the
    // display is made holding XDisplayLock: around each step that calls Xlib,
    // not around whole calls, so a call that waits (type() waits for its
    // borrowed keys) does not hold up the others. It is recursive: a step may
    // call a helper that takes it too.
    //
    // Lock order: Keyboard.type's typing mutex, then this lock, then
    // VirtualInput's device mutex or the Wayland connection's mutex. Nothing
    // holding a later one takes an earlier one (the screen list asks the
    // compositor, lets go of its mutex, and only then falls back to XRandR).
    inline std::recursive_mutex& XDisplayMutex() {
        static std::recursive_mutex mutex;
        return mutex;
    }

    struct XDisplayLock {
        std::lock_guard<std::recursive_mutex> guard{XDisplayMutex()};
    };

    // The X11 connection every module shares, opened on first use (and tried
    // again on the next call while it cannot be opened). Use it holding an
    // XDisplayLock.
    inline Display* XGetMainDisplay() {
        XDisplayLock lock;
        static Display* display = nullptr;
        if (display == nullptr) {
            display = XOpenDisplay(nullptr);
        }
        return display;
    }

    // the error of having no X display to talk to
    inline InputError NoDisplayError() {
        return InputError{ "", "Failed to open X display" };
    }

    // Throws when there is no X display to talk to; returns it otherwise.
    inline Display* RequireDisplay(Napi::Env env) {
        Display* display = XGetMainDisplay();
        if (display == nullptr) {
            ThrowInputError(env, NoDisplayError());
        }
        return display;
    }
#endif

#endif
