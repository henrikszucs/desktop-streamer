#pragma once
#ifndef GAMEPAD_WIN_H
#define GAMEPAD_WIN_H

// The Windows virtual gamepad, through easy-control's own driver
// (src/native/windows-gamepad): the broker service plugs a pad in, and this
// side sends it every state change.

#include <string>

struct WinPad;

// why something failed: a message for people and a stable code for programs
struct WinPadError {
    std::string message;
    std::string code;   // EASYCONTROL_DRIVER_MISSING, EASYCONTROL_DRIVER_OUTDATED, EASYCONTROL_NO_SLOT, ...
};

// plugs in a pad; nullptr and the reason when it cannot
WinPad* WinPadCreate(WinPadError& error);
// W3C Standard Gamepad indices: buttons 0-16, axes 0-5 with -1..1. With
// isSent false the change is only kept, for WinPadSend to send with others.
bool WinPadSetButton(WinPad* pad, int button, bool isDown, bool isSent = true);
bool WinPadSetAxis(WinPad* pad, int axis, double value, bool isSent = true);
// sends the state as it is now
bool WinPadSend(WinPad* pad);
// unplugs it and frees it
void WinPadDestroy(WinPad* pad);

// What games send the pad: the rumble motors, 0-255, left the strong (low
// frequency) one. Called on a thread of the pad's own, once per change.
typedef void (*WinPadOutputCallback)(void* context, int leftMotor, int rightMotor);
// starts that thread; a version 3 driver tells each change, an older one is
// asked every 16 ms
void WinPadStartOutput(WinPad* pad, WinPadOutputCallback callback, void* context);
// stops it and waits until it has; no call comes after
void WinPadStopOutput(WinPad* pad);

struct WinDriverStatus {
    bool isInstalled;
    int version;        // installed version, 0 when none
    int required;       // the oldest version this addon works with
    int available;      // the version beside the addon (gamepad/version.json), 0 when missing
};
WinDriverStatus WinDriverGetStatus();

// runs the setup script elevated (one UAC prompt) and waits for it; action is
// "install" or "uninstall"; force installs even over a newer version
bool WinDriverRunSetup(const wchar_t* action, bool force, WinPadError& error);

#endif
