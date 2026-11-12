#pragma once
#ifndef ARGS_H
#define ARGS_H

// Argument checks every module shares: each throws a TypeError or RangeError
// with the same message wherever it is used, and returns false; true when the
// argument is fine. Arguments are counted from 1 in the messages, as people
// count them.

#include <napi.h>

#include <cmath>
#include <string>

// at least `count` arguments
inline bool RequireArgs(const Napi::CallbackInfo& info, size_t count) {
    if (info.Length() < count) {
        Napi::TypeError::New(info.Env(), "Expected " + std::to_string(count) +
            (count == 1 ? " argument" : " arguments")).ThrowAsJavaScriptException();
        return false;
    }
    return true;
}

inline std::string ArgumentName(size_t index) {
    return "Argument " + std::to_string(index + 1);
}

// argument `index` is a string
inline bool RequireString(const Napi::CallbackInfo& info, size_t index, std::string& value) {
    if (!RequireArgs(info, index + 1)) {
        return false;
    }
    if (!info[index].IsString()) {
        Napi::TypeError::New(info.Env(), ArgumentName(index) + " must be a string").ThrowAsJavaScriptException();
        return false;
    }
    value = info[index].As<Napi::String>().Utf8Value();
    return true;
}

// argument `index` is a boolean
inline bool RequireBoolean(const Napi::CallbackInfo& info, size_t index, bool& value) {
    if (!RequireArgs(info, index + 1)) {
        return false;
    }
    if (!info[index].IsBoolean()) {
        Napi::TypeError::New(info.Env(), ArgumentName(index) + " must be a boolean").ThrowAsJavaScriptException();
        return false;
    }
    value = info[index].As<Napi::Boolean>().Value();
    return true;
}

// argument `index` is a finite number
inline bool RequireFinite(const Napi::CallbackInfo& info, size_t index, double& value) {
    if (!RequireArgs(info, index + 1)) {
        return false;
    }
    if (!info[index].IsNumber() || !std::isfinite(info[index].As<Napi::Number>().DoubleValue())) {
        Napi::TypeError::New(info.Env(), ArgumentName(index) + " must be a finite number").ThrowAsJavaScriptException();
        return false;
    }
    value = info[index].As<Napi::Number>().DoubleValue();
    return true;
}

// argument `index` is an integer from 0 to count - 1; `rangeMessage` is the
// RangeError's, which names the bounds. Checked as a double, so NaN, 1.5 and
// 2**32 + 1 are not taken for 0, 1 and 1.
inline bool RequireIndex(const Napi::CallbackInfo& info, size_t index, int count, const char* rangeMessage, int& value) {
    if (!RequireArgs(info, index + 1)) {
        return false;
    }
    const double number = info[index].IsNumber() ? info[index].As<Napi::Number>().DoubleValue() : NAN;
    if (!std::isfinite(number) || std::trunc(number) != number) {
        Napi::TypeError::New(info.Env(), ArgumentName(index) + " must be an integer").ThrowAsJavaScriptException();
        return false;
    }
    if (number < 0 || number >= count) {
        Napi::RangeError::New(info.Env(), rangeMessage).ThrowAsJavaScriptException();
        return false;
    }
    value = (int)number;
    return true;
}

// obj[name] = a function of that name, so stack traces show it
template <typename Callable>
inline Napi::Function SetFunction(Napi::Env env, Napi::Object obj, const char* name, Callable callback) {
    Napi::Function function = Napi::Function::New(env, callback, name);
    obj.Set(name, function);
    return function;
}

#endif
