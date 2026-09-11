// General addons
#include <napi.h>


// Check platform
#if !defined(IS_WINDOWS) && !defined(IS_MACOS) && !defined(IS_LINUX)
    #error "Unsupported platform"
#endif

// Include general alignments
#ifndef BYTE_ALIGN
    /* Interval to align by for large buffers (e.g. bitmaps). */
    /* Must be a power of 2. */
    #define BYTE_ALIGN 4 /* Bytes to align pixel buffers to. */
    /* #include <stddef.h> */
    /* #define BYTE_ALIGN (sizeof(size_t)) */
#endif

#if BYTE_ALIGN == 0
    /* No alignment needed. */
    #define ADD_PADDING(width) (width)
#else
    /* Aligns given width to padding. */
    #define ADD_PADDING(width) (BYTE_ALIGN + (((width) - 1) & ~(BYTE_ALIGN - 1)))
#endif

#if !defined(M_SQRT2)
	#define M_SQRT2 1.4142135623730950488016887 /* Fix for MSVC. */
#endif

#if defined(IS_WINDOWS)
    #define STRICT /* Require use of exact types. */
    #define WIN32_LEAN_AND_MEAN 1 /* Speed up compilation. */
#endif

// Include modules
#include "mouse.h"
#include "keyboard.h"
#include "gamepad.h"
#include "screen.h"


Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set(Napi::String::New(env, "Mouse"), Mouse::Init(env, exports));
    obj.Set(Napi::String::New(env, "Keyboard"), Keyboard::Init(env, exports));
    obj.Set(Napi::String::New(env, "Gamepad"), Gamepad::Init(env, exports));
    obj.Set(Napi::String::New(env, "Screen"), IScreen::Init(env, exports));

    return obj;
}

NODE_API_MODULE(addon, InitAll);