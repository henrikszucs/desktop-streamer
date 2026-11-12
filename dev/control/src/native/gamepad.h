#pragma once
#ifndef GAMEPAD_H
#define GAMEPAD_H

#include <napi.h>
#include <cstdint>
#include <memory>
#include <thread>
#include <vector>

#if defined(IS_WINDOWS)
    struct WinPad;  // gamepad_win.h
#elif defined(IS_LINUX)
    #include <linux/input.h>
#endif

struct RumbleSink;  // gamepad.cpp

// Button and axis indices follow the W3C Standard Gamepad layout:
//     buttons 0-16: A, B, X, Y, LB, RB, LT, RT, Back, Start, LS, RS,
//                   D-pad up, down, left, right, Home
//     axes 0-3:     left stick X, Y; right stick X, Y (-1 to 1, Y down positive)
//     axes 4-5:     left and right trigger, analog (-1 released to 1 pulled)
class Gamepad : public Napi::ObjectWrap<Gamepad> {
    public:
        static Napi::Object Init(Napi::Env env, Napi::Object exports);
        static Napi::Value list(const Napi::CallbackInfo& info);
        static Napi::Value CreateObject(const Napi::CallbackInfo& info);
        // the virtual gamepad driver (Windows only; elsewhere nothing to install)
        static Napi::Value GetDriverStatus(const Napi::CallbackInfo& info);
        static Napi::Value InstallDriver(const Napi::CallbackInfo& info);
        static Napi::Value UninstallDriver(const Napi::CallbackInfo& info);
        Gamepad(const Napi::CallbackInfo& info);
        ~Gamepad();
        Napi::Value IsActive(const Napi::CallbackInfo& info);
        void Destroy(const Napi::CallbackInfo& info);
        void ButtonDown(const Napi::CallbackInfo& info);
        void ButtonUp(const Napi::CallbackInfo& info);
        void SetAxis(const Napi::CallbackInfo& info);
        void SetState(const Napi::CallbackInfo& info);
        Napi::Value GetOnRumble(const Napi::CallbackInfo& info);
        void SetOnRumble(const Napi::CallbackInfo& info, const Napi::Value& value);
    private:
        // unplugs the virtual device and frees it; safe to call more than once
        void Release();
        void SetButton(const Napi::CallbackInfo& info, bool isDown);
        // throws and returns false when the pad is destroyed
        bool RequireActive(Napi::Env env);

        bool m_active = false;
        // where games' rumble goes: the onRumble listener
        std::unique_ptr<RumbleSink> m_rumble;
        Napi::FunctionReference m_onRumble;
        #if defined(IS_WINDOWS)
            WinPad* m_pad = nullptr;
        #elif defined(IS_MACOS)
            int m_gamepad_id = -1;
        #elif defined(IS_LINUX)
            // the changes for one report: a button, the trigger or an axis
            void AddButton(std::vector<struct input_event>& events, int button, bool isDown);
            void AddAxis(std::vector<struct input_event>& events, int axis, double value);
            // writes the changes and the report closing them
            bool WriteEvents(std::vector<struct input_event>& events);

            int m_uinput_fd = -1;
            // D-pad directions held: bit 0 up, 1 down, 2 left, 3 right
            uint8_t m_dpad = 0;
            // answers the kernel's force feedback requests (it waits for an
            // answer, so this runs while the pad lives), and tells the rumble
            std::thread m_ffThread;
            int m_stopFd = -1;
        #endif
};

#endif
