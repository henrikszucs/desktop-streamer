#pragma once
#ifndef MOUSE_H
#define MOUSE_H

#include <napi.h>

class Mouse {
    public:
        static Napi::Object Init(Napi::Env env, Napi::Object exports);
        static Napi::Value getX(const Napi::CallbackInfo& info);
        static Napi::Value getY(const Napi::CallbackInfo& info);
        static Napi::Value getPosition(const Napi::CallbackInfo& info);
        static Napi::Object getIcon(const Napi::CallbackInfo& info);
        static Napi::Number getIconId(const Napi::CallbackInfo& info);
        static void setX(const Napi::CallbackInfo& info);
        static void setY(const Napi::CallbackInfo& info);
        static void setPosition(const Napi::CallbackInfo& info);
        static void moveBy(const Napi::CallbackInfo& info);
        static void moveByX(const Napi::CallbackInfo& info);
        static void moveByY(const Napi::CallbackInfo& info);
        static void buttonDown(const Napi::CallbackInfo& info);
        static void buttonUp(const Napi::CallbackInfo& info);
        static void releaseAll(const Napi::CallbackInfo& info);
        static void scrollDown(const Napi::CallbackInfo& info);
        static void scrollUp(const Napi::CallbackInfo& info);
        static void scroll(const Napi::CallbackInfo& info);
};

#endif