/*
 * The contract between the parts of the easy-control virtual gamepad on
 * Windows: the addon (src/native/gamepad.cpp), the broker service
 * (service/service.cpp) and the UMDF driver (driver/driver.c).
 *
 * One virtual gamepad is two software devices made by the service:
 *   - the XUSB device: registers the interface XInput looks for and answers
 *     XInput's requests (games, browsers, SDL, Windows.Gaming.Input)
 *   - the HID device: a HID gamepad for DirectInput and Raw Input, whose
 *     path carries "IG_" so that XInput-aware readers skip it
 * The addon sends every state change to both.
 */
#pragma once

#include <windows.h>
#include <winioctl.h>

// Versions. The driver is installed once per machine and shared by every app
// on it, each with an addon of its own easy-control version, so:
//
//   A newer driver and service serve every older addon. What is below never
//   changes its meaning: IOCTL codes, pipe commands and struct layouts are
//   only ever added, and a pipe response keeps the size the client's version
//   (EASYCONTROL_PIPE_REQUEST.Version) knows.
//
// EASYCONTROL_PAD_VERSION is this driver, service and setup's version, bumped
// for any change to them; the setup writes it to HKLM\SOFTWARE\easy-control\
// Gamepad "Version" (last, so a half-done install has none), the service
// answers it on the pipe and the driver to EASYCONTROL_IOCTL_GET_VERSION.
// EASYCONTROL_PAD_MIN_VERSION is the oldest installed version the addon works
// with; raised only when the addon needs what older drivers lack. Anything
// newer than that is an optional update, and what a driver can do is told by
// its version (EASYCONTROL_PAD_FEATURE_*).
#define EASYCONTROL_PAD_VERSION 3
#define EASYCONTROL_PAD_MIN_VERSION 2

// from version 2: EASYCONTROL_IOCTL_GET_OUTPUT, the rumble and LED state
#define EASYCONTROL_PAD_FEATURE_OUTPUT_POLL 0x0001
// from version 3: EASYCONTROL_IOCTL_WAIT_OUTPUT, answered when they change
#define EASYCONTROL_PAD_FEATURE_OUTPUT_WAIT 0x0002

// the identity of an Xbox 360 controller, which is what games expect
#define EASYCONTROL_PAD_VID 0x045E
#define EASYCONTROL_PAD_PID 0x028E
#define EASYCONTROL_PAD_PRODUCT_VERSION 0x0114

// XInput's device interface, {EC87F1E3-C13B-4100-B5F7-8B84D54260CB}
static const GUID EASYCONTROL_GUID_DEVINTERFACE_XUSB =
    { 0xEC87F1E3, 0xC13B, 0x4100, { 0xB5, 0xF7, 0x8B, 0x84, 0xD5, 0x42, 0x60, 0xCB } };

// software device names (SwDeviceCreate) and the hardware IDs the INFs bind
// to; Windows.Gaming.Input takes a device for an Xbox 360 pad by the VID/PID
// and XI_00 in its hardware ID, as on the companion devices of HIDMaestro
#define EASYCONTROL_XUSB_ENUMERATOR L"EasyControl"
#define EASYCONTROL_XUSB_HARDWARE_ID L"EasyControl\\VID_045E&PID_028E&XI_00"
// the same device without Microsoft's xinputhid filter, for Windows editions
// that lack it (Windows Server): XInput reads it, Windows.Gaming.Input not
#define EASYCONTROL_XUSB_PLAIN_HARDWARE_ID L"EasyControl\\XusbPad"
// "IG_" in the enumerator name puts it into the HID collection's device path
// (\\?\HID#EasyControl_IG_00#...), as Windows' own "XINPUT compatible HID
// device" has; Chromium, SDL and the DirectInput IsXInputDevice check skip
// such devices and read the pad through XInput instead
#define EASYCONTROL_HID_ENUMERATOR L"EasyControl_IG_00"
#define EASYCONTROL_HID_HARDWARE_ID L"EasyControl\\HidPad&IG_00"

#define EASYCONTROL_SERVICE_NAME L"EasyControlGamepad"
#define EASYCONTROL_PIPE_NAME L"\\\\.\\pipe\\easy-control-gamepad"
#define EASYCONTROL_REGISTRY_KEY L"SOFTWARE\\easy-control\\Gamepad"

// XInput has 4 user slots
#define EASYCONTROL_MAX_PADS 4

#pragma pack(push, 1)

// the whole pad state, in XInput's layout (XINPUT_GAMEPAD): Y up positive,
// triggers 0-255; the driver converts it for HID
typedef struct _EASYCONTROL_PAD_STATE {
    UINT16 Buttons;         // XINPUT_GAMEPAD_* bits, 0x0400 is the guide button
    UINT8  LeftTrigger;
    UINT8  RightTrigger;
    INT16  ThumbLX;
    INT16  ThumbLY;
    INT16  ThumbRX;
    INT16  ThumbRY;
} EASYCONTROL_PAD_STATE;

// what games sent to the pad: rumble motors 0-255 and the XInput LED state
typedef struct _EASYCONTROL_PAD_OUTPUT {
    UINT8 LeftMotor;
    UINT8 RightMotor;
    UINT8 LedState;
} EASYCONTROL_PAD_OUTPUT;

// EASYCONTROL_IOCTL_GET_VERSION's answer (version 3; a version 2 driver
// refuses the request with ERROR_INVALID_FUNCTION)
typedef struct _EASYCONTROL_PAD_VERSION_INFO {
    UINT32 Version;         // EASYCONTROL_PAD_VERSION of the running driver
    UINT32 Features;        // EASYCONTROL_PAD_FEATURE_* bits
} EASYCONTROL_PAD_VERSION_INFO;

// EASYCONTROL_IOCTL_WAIT_OUTPUT: in, the serial of the output last seen (0 at
// first); out, the output and its serial, once it differs
typedef struct _EASYCONTROL_PAD_OUTPUT_EVENT {
    UINT32 Serial;          // counts every change of the output
    EASYCONTROL_PAD_OUTPUT Output;
} EASYCONTROL_PAD_OUTPUT_EVENT;

#pragma pack(pop)

// sent to the XUSB device, beside XInput's own requests
#define EASYCONTROL_IOCTL_SET_STATE   CTL_CODE(0x8000, 0x900, METHOD_BUFFERED, FILE_WRITE_ACCESS)
#define EASYCONTROL_IOCTL_GET_OUTPUT  CTL_CODE(0x8000, 0x901, METHOD_BUFFERED, FILE_READ_ACCESS)
#define EASYCONTROL_IOCTL_GET_VERSION CTL_CODE(0x8000, 0x902, METHOD_BUFFERED, FILE_ANY_ACCESS)
#define EASYCONTROL_IOCTL_WAIT_OUTPUT CTL_CODE(0x8000, 0x903, METHOD_BUFFERED, FILE_READ_ACCESS)

// HID device: input report 1 is the gamepad, feature report 2 (on a
// vendor-defined collection) takes an EASYCONTROL_PAD_STATE
#define EASYCONTROL_HID_INPUT_REPORT_ID 1
#define EASYCONTROL_HID_STATE_REPORT_ID 2
#define EASYCONTROL_HID_VENDOR_USAGE_PAGE 0xFF00


// the service's pipe: one connection per pad, which lives while the
// connection is open; a request and its response are single messages
#define EASYCONTROL_PIPE_MAGIC 0x47504345u   // "ECPG"

typedef enum _EASYCONTROL_PIPE_COMMAND {
    EASYCONTROL_PIPE_CREATE = 1,    // plug in a pad for this connection
    EASYCONTROL_PIPE_VERSION = 2    // only answer the version
} EASYCONTROL_PIPE_COMMAND;

typedef struct _EASYCONTROL_PIPE_REQUEST {
    UINT32 Magic;
    UINT32 Version;
    UINT32 Command;
} EASYCONTROL_PIPE_REQUEST;

typedef struct _EASYCONTROL_PIPE_RESPONSE {
    UINT32 Magic;
    UINT32 Version;
    INT32  Result;                  // HRESULT
    WCHAR  XusbInstanceId[200];     // device instance IDs of the pad's two devices
    WCHAR  HidInstanceId[200];
} EASYCONTROL_PIPE_RESPONSE;

// HRESULTs the service answers with
#define EASYCONTROL_E_NO_SLOT HRESULT_FROM_WIN32(ERROR_NO_MORE_ITEMS)
