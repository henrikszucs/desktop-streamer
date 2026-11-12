#pragma once
#ifndef ACCESS_H
#define ACCESS_H

#include <napi.h>

// Whether this process may send input, and asking for it where the system
// asks the user (the loader puts these on the Platform export).
class InputAccess {
    public:
        static Napi::Object Init(Napi::Env env, Napi::Object exports);
        static Napi::Boolean hasInputAccess(const Napi::CallbackInfo& info);
        static Napi::Value requestInputAccess(const Napi::CallbackInfo& info);
        static Napi::Value getInputBlock(const Napi::CallbackInfo& info);
};

#endif
