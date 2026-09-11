#pragma once
#ifndef GAMEPAD_H
#define GAMEPAD_H

#include <napi.h>
#include <vector>

#if defined(IS_WINDOWS)
    // Opaque pointer - the actual type is defined in the .cpp file
    typedef struct _VIGEM_CLIENT_T* PVIGEM_CLIENT;
    typedef struct _VIGEM_TARGET_T* PVIGEM_TARGET;

    // Forward declare XUSB_REPORT structure as a pointer
    struct _XUSB_REPORT;
    typedef struct _XUSB_REPORT XUSB_REPORT;
    typedef struct _XUSB_REPORT* PXUSB_REPORT;
    
#elif defined(IS_MACOS)
    
#elif defined(IS_LINUX)
    // Linux uinput file descriptor
    typedef int UINPUT_FD;
    
    // Structure to track gamepad state
    struct GamepadState {
        short thumbLX;
        short thumbLY;
        short thumbRX;
        short thumbRY;
        unsigned char leftTrigger;
        unsigned char rightTrigger;
        unsigned short buttons;
    };
#endif

class InstallDriver : public Napi::AsyncWorker {
    public:
        InstallDriver(const Napi::Env& env);
        Napi::Promise GetPromise();

    protected:
        void Execute();
        void OnOK();
        void OnError(const Napi::Error& e);

    private:
        Napi::Promise::Deferred m_deferred;
        bool m_result;

};

class Gamepad : public Napi::ObjectWrap<Gamepad> {
    public:
        static Napi::Object Init(Napi::Env env, Napi::Object exports);
        static Napi::Value list(const Napi::CallbackInfo& info);
        static Napi::Object CreateObject(const Napi::CallbackInfo& info);
        static Napi::Object NewInstance(Napi::Env env);
        Gamepad(const Napi::CallbackInfo& info);
        ~Gamepad();
        Napi::Value IsActive(const Napi::CallbackInfo& info);
        void Destroy(const Napi::CallbackInfo& info);
        void ButtonDown(const Napi::CallbackInfo& info);
        void ButtonUp(const Napi::CallbackInfo& info);
        void SetAxis(const Napi::CallbackInfo& info);
    private:
        bool m_active = false;
        #if defined(IS_WINDOWS)
            PVIGEM_CLIENT m_client = nullptr;
            PVIGEM_TARGET m_pad = nullptr;
            PXUSB_REPORT m_report = nullptr;
        #elif defined(IS_MACOS)
            int m_gamepad_id = -1;

        #elif defined(IS_LINUX)
            UINPUT_FD m_uinput_fd = -1;
            GamepadState* m_state = nullptr;
        #endif
};

#endif