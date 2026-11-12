/*
 * easy-control virtual gamepad: UMDF 2 driver
 *
 * One DLL serves both devices of a pad (see common/easycontrol_pad.h); which
 * one it is comes from the device's hardware ID:
 *
 *   XUSB device  function driver; registers XInput's device interface and
 *                answers XInput's requests from the last state it was sent
 *   HID device   HID minidriver, a lower filter under mshidumdf.sys (as in
 *                Microsoft's vhidmini2 sample); a gamepad collection read by
 *                DirectInput and Raw Input, and a vendor collection whose
 *                feature report takes the state
 *
 * XInput's requests are undocumented. Their codes and buffer layouts follow
 * what XInput1_4.dll sends, as reverse engineered by the OpenXInput project;
 * what Windows.Gaming.Input needs on top (the pending input request, protocol
 * 1.3, the capability values of a real wired pad) follows HIDMaestro
 * (https://github.com/hifihedgehog/HIDMaestro, MIT), which worked it out.
 */

#define WIN32_NO_STATUS
#include <windows.h>
#undef WIN32_NO_STATUS
#include <wdf.h>
#include <hidport.h>

#include "../common/easycontrol_pad.h"


DRIVER_INITIALIZE DriverEntry;
EVT_WDF_DRIVER_DEVICE_ADD EvtDeviceAdd;
EVT_WDF_IO_QUEUE_IO_DEVICE_CONTROL EvtXusbDeviceControl;
EVT_WDF_IO_QUEUE_IO_DEVICE_CONTROL EvtHidDeviceControl;


typedef struct _DEVICE_CONTEXT {
    BOOLEAN IsHid;

    EASYCONTROL_PAD_STATE State;
    EASYCONTROL_PAD_OUTPUT Output;
    DWORD PacketNumber;         // XInput's change counter

    // HID: pending IOCTL_HID_READ_REPORT requests, and whether a state came
    // that no read has carried yet
    // XUSB: the same for Windows.Gaming.Input's pending input requests
    WDFQUEUE ReadQueue;
    BOOLEAN HasNewState;
    HID_DEVICE_ATTRIBUTES HidAttributes;

    // XUSB: the addon's pending EASYCONTROL_IOCTL_WAIT_OUTPUT requests, and
    // the count of output changes they are answered with
    WDFQUEUE OutputQueue;
    UINT32 OutputSerial;
} DEVICE_CONTEXT, *PDEVICE_CONTEXT;

WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(DEVICE_CONTEXT, GetDeviceContext);


//
// XInput's requests on the XUSB interface
//

#define XUSB_IOCTL_GET_INFORMATION          0x80006000
#define XUSB_IOCTL_GET_CAPABILITIES         0x8000E004
#define XUSB_IOCTL_GET_LED_STATE            0x8000E008
#define XUSB_IOCTL_GET_STATE                0x8000E00C
#define XUSB_IOCTL_SET_STATE                0x8000A010
#define XUSB_IOCTL_WAIT_FOR_GUIDE_BUTTON    0x8000A014
#define XUSB_IOCTL_GET_BATTERY_INFORMATION  0x8000E018
#define XUSB_IOCTL_POWER_DOWN               0x8000A01C
#define XUSB_IOCTL_GET_AUDIO_INFORMATION    0x8000E020
#define XUSB_IOCTL_POWER_INFORMATION        0x80006380
#define XUSB_IOCTL_WAIT_FOR_INPUT           0x8000E3AC  // Windows.Gaming.Input keeps one pending
#define XUSB_IOCTL_GET_INFORMATION_EX       0x8000E3FC

// the protocol version a wired Xbox 360 pad speaks; Windows.Gaming.Input
// sends vibration only to 1.3 devices
#define XUSB_VERSION 0x0103

// how often a pending Windows.Gaming.Input request is answered even
// without a change, so it keeps reading the pad
#define XUSB_INPUT_PERIOD_MS 50

#define XUSB_SET_STATE_FLAG_LED         0x01
#define XUSB_SET_STATE_FLAG_VIBRATION   0x02

#define XINPUT_DEVTYPE_GAMEPAD          0x01
#define XINPUT_DEVSUBTYPE_GAMEPAD       0x01
#define BATTERY_TYPE_WIRED              0x01
#define BATTERY_LEVEL_FULL              0x03

#pragma pack(push, 1)

typedef struct _XUSB_INFORMATION {
    UINT16 Version;
    UINT8  DeviceCount;         // users on this interface; a wired pad has one
    UINT8  Unknown1;
    UINT8  Flags;               // 0x80: XInput ignores the device
    UINT8  Unknown3;
    UINT16 Unknown4;
    UINT16 VendorId;
    UINT16 ProductId;
} XUSB_INFORMATION;

typedef struct _XUSB_REQUEST {
    UINT16 Version;
    UINT8  DeviceIndex;
} XUSB_REQUEST;

typedef struct _XUSB_SET_STATE {
    UINT8 DeviceIndex;
    UINT8 LedState;
    UINT8 LeftMotor;
    UINT8 RightMotor;
    UINT8 Flags;
} XUSB_SET_STATE;

typedef struct _XUSB_LED_STATE {
    UINT16 Version;
    UINT8  LedState;
} XUSB_LED_STATE;

// the gamepad fields shared by the state and capabilities answers
typedef struct _XUSB_GAMEPAD {
    UINT16 Buttons;
    UINT8  LeftTrigger;
    UINT8  RightTrigger;
    INT16  ThumbLX;
    INT16  ThumbLY;
    INT16  ThumbRX;
    INT16  ThumbRY;
} XUSB_GAMEPAD;

// state, protocol 1.0
typedef struct _XUSB_STATE_0100 {
    UINT8  Status;              // 1: connected
    UINT8  Unknown0;
    UINT8  InputId;
    UINT32 PacketNumber;
    UINT8  Unknown2;
    XUSB_GAMEPAD Gamepad;
} XUSB_STATE_0100;

// state, protocol 1.1 and later
typedef struct _XUSB_STATE_0101 {
    UINT16 Version;
    UINT8  Status;
    UINT8  Unknown2;
    UINT8  InputId;
    UINT32 PacketNumber;
    UINT8  Unknown4;
    UINT8  Unknown5;
    XUSB_GAMEPAD Gamepad;
    UINT8  Unknown6[5];
    UINT8  ExtraButtons;
} XUSB_STATE_0101;

// capabilities, protocol 1.1
typedef struct _XUSB_CAPABILITIES_0101 {
    UINT16 Version;
    UINT8  Type;
    UINT8  SubType;
    XUSB_GAMEPAD Gamepad;
    UINT8  Unknown[6];
    UINT8  LeftMotor;
    UINT8  RightMotor;
} XUSB_CAPABILITIES_0101;

// capabilities, protocol 1.2
typedef struct _XUSB_CAPABILITIES_0102 {
    UINT16 Version;
    UINT8  Type;
    UINT8  SubType;
    UINT16 Flags;
    UINT16 VendorId;
    UINT16 ProductId;
    UINT16 ProductVersion;
    UINT32 Unknown3;
    XUSB_GAMEPAD Gamepad;
    UINT32 Unknown4;
    UINT8  Unknown5;
    UINT8  Unknown6;
    UINT8  LeftMotor;
    UINT8  RightMotor;
} XUSB_CAPABILITIES_0102;

typedef struct _XUSB_BATTERY_INFORMATION {
    UINT16 Version;
    UINT8  BatteryType;
    UINT8  BatteryLevel;
} XUSB_BATTERY_INFORMATION;

#pragma pack(pop)

// what a pad reports it has: every button, full trigger and stick range
// (the sticks' resolution bits as a wired Xbox 360 pad reports them, 0xFFC0)
static const XUSB_GAMEPAD XusbFullCapabilities = {
    0xF7FF, 0xFF, 0xFF, -64, -64, -64, -64
};


//
// the HID gamepad
//

#define HID_INPUT_REPORT_SIZE 14
#define HID_STATE_REPORT_SIZE (1 + sizeof(EASYCONTROL_PAD_STATE))

static const UCHAR HidReportDescriptor[] = {
    0x05, 0x01,                     // USAGE_PAGE (Generic Desktop)
    0x09, 0x05,                     // USAGE (Game Pad)
    0xA1, 0x01,                     // COLLECTION (Application)
    0x85, EASYCONTROL_HID_INPUT_REPORT_ID, //   REPORT_ID (1)
    0x09, 0x30,                     //   USAGE (X)          left stick
    0x09, 0x31,                     //   USAGE (Y)
    0x09, 0x33,                     //   USAGE (Rx)         right stick
    0x09, 0x34,                     //   USAGE (Ry)
    0x16, 0x00, 0x80,               //   LOGICAL_MINIMUM (-32768)
    0x26, 0xFF, 0x7F,               //   LOGICAL_MAXIMUM (32767)
    0x75, 0x10,                     //   REPORT_SIZE (16)
    0x95, 0x04,                     //   REPORT_COUNT (4)
    0x81, 0x02,                     //   INPUT (Data,Var,Abs)
    0x09, 0x32,                     //   USAGE (Z)          left trigger
    0x09, 0x35,                     //   USAGE (Rz)         right trigger
    0x15, 0x00,                     //   LOGICAL_MINIMUM (0)
    0x26, 0xFF, 0x00,               //   LOGICAL_MAXIMUM (255)
    0x75, 0x08,                     //   REPORT_SIZE (8)
    0x95, 0x02,                     //   REPORT_COUNT (2)
    0x81, 0x02,                     //   INPUT (Data,Var,Abs)
    0x09, 0x39,                     //   USAGE (Hat switch)  D-pad
    0x15, 0x00,                     //   LOGICAL_MINIMUM (0)
    0x25, 0x07,                     //   LOGICAL_MAXIMUM (7)
    0x35, 0x00,                     //   PHYSICAL_MINIMUM (0)
    0x46, 0x3B, 0x01,               //   PHYSICAL_MAXIMUM (315)
    0x65, 0x14,                     //   UNIT (Eng Rot: Degrees)
    0x75, 0x04,                     //   REPORT_SIZE (4)
    0x95, 0x01,                     //   REPORT_COUNT (1)
    0x81, 0x42,                     //   INPUT (Data,Var,Abs,Null)
    0x65, 0x00,                     //   UNIT (None)
    0x45, 0x00,                     //   PHYSICAL_MAXIMUM (0)
    0x75, 0x04,                     //   REPORT_SIZE (4)
    0x95, 0x01,                     //   REPORT_COUNT (1)
    0x81, 0x03,                     //   INPUT (Cnst,Var,Abs)    padding
    0x05, 0x09,                     //   USAGE_PAGE (Button)
    0x19, 0x01,                     //   USAGE_MINIMUM (1)
    0x29, 0x0B,                     //   USAGE_MAXIMUM (11)
    0x15, 0x00,                     //   LOGICAL_MINIMUM (0)
    0x25, 0x01,                     //   LOGICAL_MAXIMUM (1)
    0x75, 0x01,                     //   REPORT_SIZE (1)
    0x95, 0x0B,                     //   REPORT_COUNT (11)
    0x81, 0x02,                     //   INPUT (Data,Var,Abs)
    0x75, 0x05,                     //   REPORT_SIZE (5)
    0x95, 0x01,                     //   REPORT_COUNT (1)
    0x81, 0x03,                     //   INPUT (Cnst,Var,Abs)    padding
    0xC0,                           // END_COLLECTION

    0x06, 0x00, 0xFF,               // USAGE_PAGE (Vendor Defined 0xFF00)
    0x09, 0x01,                     // USAGE (Vendor Usage 1)
    0xA1, 0x01,                     // COLLECTION (Application)
    0x85, EASYCONTROL_HID_STATE_REPORT_ID, //   REPORT_ID (2)
    0x09, 0x01,                     //   USAGE (Vendor Usage 1)
    0x15, 0x00,                     //   LOGICAL_MINIMUM (0)
    0x26, 0xFF, 0x00,               //   LOGICAL_MAXIMUM (255)
    0x75, 0x08,                     //   REPORT_SIZE (8)
    0x95, sizeof(EASYCONTROL_PAD_STATE), // REPORT_COUNT
    0xB1, 0x02,                     //   FEATURE (Data,Var,Abs)
    0xC0                            // END_COLLECTION
};

static const HID_DESCRIPTOR HidDescriptor = {
    0x09,                           // bLength
    0x21,                           // bDescriptorType: HID
    0x0110,                         // bcdHID
    0x00,                           // bCountry
    0x01,                           // bNumDescriptors
    { { 0x22, sizeof(HidReportDescriptor) } }   // report descriptor
};

// HID button bit for each XInput button, in DirectInput's Xbox 360 order:
// A B X Y LB RB Back Start LS RS Guide
static const struct { UINT16 Xinput; UINT16 Hid; } HidButtonMap[] = {
    { 0x1000, 1u << 0 },    // A
    { 0x2000, 1u << 1 },    // B
    { 0x4000, 1u << 2 },    // X
    { 0x8000, 1u << 3 },    // Y
    { 0x0100, 1u << 4 },    // left shoulder
    { 0x0200, 1u << 5 },    // right shoulder
    { 0x0020, 1u << 6 },    // back
    { 0x0010, 1u << 7 },    // start
    { 0x0040, 1u << 8 },    // left thumb
    { 0x0080, 1u << 9 },    // right thumb
    { 0x0400, 1u << 10 }    // guide
};

// HID's Y axes grow downwards, XInput's upwards
static INT16 FlipAxis(INT16 value)
{
    return value == -32768 ? 32767 : (INT16)-value;
}

// the hat switch value of the D-pad bits; 8 is the null state (centred)
static UCHAR DpadToHat(UINT16 buttons)
{
    const BOOLEAN up = (buttons & 0x0001) != 0;
    const BOOLEAN down = (buttons & 0x0002) != 0;
    const BOOLEAN left = (buttons & 0x0004) != 0;
    const BOOLEAN right = (buttons & 0x0008) != 0;
    if (up && right) return 1;
    if (right && down) return 3;
    if (down && left) return 5;
    if (left && up) return 7;
    if (up) return 0;
    if (right) return 2;
    if (down) return 4;
    if (left) return 6;
    return 8;
}

static void BuildInputReport(const EASYCONTROL_PAD_STATE* state, UCHAR report[HID_INPUT_REPORT_SIZE])
{
    const INT16 axes[4] = { state->ThumbLX, FlipAxis(state->ThumbLY), state->ThumbRX, FlipAxis(state->ThumbRY) };
    UINT16 buttons = 0;
    for (int i = 0; i < ARRAYSIZE(HidButtonMap); i++) {
        if (state->Buttons & HidButtonMap[i].Xinput) {
            buttons |= HidButtonMap[i].Hid;
        }
    }
    report[0] = EASYCONTROL_HID_INPUT_REPORT_ID;
    for (int i = 0; i < 4; i++) {
        report[1 + i * 2] = (UCHAR)(axes[i] & 0xFF);
        report[2 + i * 2] = (UCHAR)((axes[i] >> 8) & 0xFF);
    }
    report[9] = state->LeftTrigger;
    report[10] = state->RightTrigger;
    report[11] = DpadToHat(state->Buttons);
    report[12] = (UCHAR)(buttons & 0xFF);
    report[13] = (UCHAR)(buttons >> 8);
}


//
// helpers
//

// copies a buffer into a request's output memory (METHOD_NEITHER HID IOCTLs)
static NTSTATUS CopyToRequestMemory(WDFREQUEST request, const void* source, size_t length)
{
    WDFMEMORY memory;
    size_t outputLength;
    NTSTATUS status = WdfRequestRetrieveOutputMemory(request, &memory);
    if (!NT_SUCCESS(status)) {
        return status;
    }
    WdfMemoryGetBuffer(memory, &outputLength);
    if (outputLength < length) {
        return STATUS_INVALID_BUFFER_SIZE;
    }
    status = WdfMemoryCopyFromBuffer(memory, 0, (PVOID)source, length);
    if (NT_SUCCESS(status)) {
        WdfRequestSetInformation(request, length);
    }
    return status;
}

// copies a buffer into a request's output buffer (METHOD_BUFFERED IOCTLs)
static NTSTATUS CopyToRequestBuffer(WDFREQUEST request, const void* source, size_t length)
{
    PVOID buffer;
    NTSTATUS status = WdfRequestRetrieveOutputBuffer(request, length, &buffer, NULL);
    if (!NT_SUCCESS(status)) {
        return status;
    }
    memcpy(buffer, source, length);
    WdfRequestSetInformation(request, length);
    return STATUS_SUCCESS;
}

static void FillXusbGamepad(const EASYCONTROL_PAD_STATE* state, XUSB_GAMEPAD* gamepad)
{
    gamepad->Buttons = state->Buttons;
    gamepad->LeftTrigger = state->LeftTrigger;
    gamepad->RightTrigger = state->RightTrigger;
    gamepad->ThumbLX = state->ThumbLX;
    gamepad->ThumbLY = state->ThumbLY;
    gamepad->ThumbRX = state->ThumbRX;
    gamepad->ThumbRY = state->ThumbRY;
}


//
// HID device
//

// completes one pending read with the current state, if one is pending
static void CompletePendingRead(PDEVICE_CONTEXT context)
{
    WDFREQUEST request;
    if (!NT_SUCCESS(WdfIoQueueRetrieveNextRequest(context->ReadQueue, &request))) {
        context->HasNewState = TRUE;
        return;
    }
    UCHAR report[HID_INPUT_REPORT_SIZE];
    BuildInputReport(&context->State, report);
    WdfRequestComplete(request, CopyToRequestMemory(request, report, sizeof(report)));
    context->HasNewState = FALSE;
}

// IOCTL_HID_READ_REPORT: answered at once if the state changed since the
// last read, else kept until it does (hidclass keeps reads pending)
static NTSTATUS HidReadReport(PDEVICE_CONTEXT context, WDFREQUEST request, BOOLEAN* complete)
{
    if (context->HasNewState) {
        UCHAR report[HID_INPUT_REPORT_SIZE];
        BuildInputReport(&context->State, report);
        context->HasNewState = FALSE;
        return CopyToRequestMemory(request, report, sizeof(report));
    }
    NTSTATUS status = WdfRequestForwardToIoQueue(request, context->ReadQueue);
    *complete = !NT_SUCCESS(status);
    return status;
}

// the report a UMDF HID set request carries; mshidumdf passes the report ID
// as the output buffer length and the report (ID first) as the input buffer
static NTSTATUS GetWritePacket(WDFREQUEST request, UCHAR* reportId, PUCHAR* buffer, size_t* length)
{
    WDFMEMORY memory;
    size_t outputLength = 0;
    NTSTATUS status = WdfRequestRetrieveOutputMemory(request, &memory);
    if (NT_SUCCESS(status)) {
        WdfMemoryGetBuffer(memory, &outputLength);
    }
    *reportId = (UCHAR)outputLength;
    status = WdfRequestRetrieveInputMemory(request, &memory);
    if (!NT_SUCCESS(status)) {
        return status;
    }
    *buffer = (PUCHAR)WdfMemoryGetBuffer(memory, length);
    return STATUS_SUCCESS;
}

// IOCTL_UMDF_HID_SET_FEATURE: report 2 is a new state from the addon
static NTSTATUS HidSetFeature(PDEVICE_CONTEXT context, WDFREQUEST request)
{
    UCHAR reportId;
    PUCHAR buffer;
    size_t length;
    NTSTATUS status = GetWritePacket(request, &reportId, &buffer, &length);
    if (!NT_SUCCESS(status)) {
        return status;
    }
    // the buffer starts with the report ID; some paths leave it out
    if (length == HID_STATE_REPORT_SIZE && buffer[0] == EASYCONTROL_HID_STATE_REPORT_ID) {
        buffer++;
        length--;
    } else if (reportId != EASYCONTROL_HID_STATE_REPORT_ID) {
        return STATUS_INVALID_PARAMETER;
    }
    if (length != sizeof(EASYCONTROL_PAD_STATE)) {
        return STATUS_INVALID_BUFFER_SIZE;
    }
    memcpy(&context->State, buffer, sizeof(EASYCONTROL_PAD_STATE));
    CompletePendingRead(context);
    WdfRequestSetInformation(request, length + 1);
    return STATUS_SUCCESS;
}

// IOCTL_HID_GET_STRING: the string ID is in the low word of the input
static NTSTATUS HidGetString(WDFREQUEST request)
{
    static const WCHAR manufacturer[] = L"easy-control";
    static const WCHAR product[] = L"easy-control Virtual Gamepad";
    static const WCHAR serial[] = L"0";
    WDFMEMORY memory;
    size_t length;
    ULONG stringId = HID_STRING_ID_IPRODUCT;
    if (NT_SUCCESS(WdfRequestRetrieveInputMemory(request, &memory))) {
        PVOID buffer = WdfMemoryGetBuffer(memory, &length);
        if (length >= sizeof(ULONG)) {
            stringId = (*(PULONG)buffer) & 0xFFFF;
        }
    }
    switch (stringId) {
    case HID_STRING_ID_IMANUFACTURER:
        return CopyToRequestMemory(request, manufacturer, sizeof(manufacturer));
    case HID_STRING_ID_IPRODUCT:
        return CopyToRequestMemory(request, product, sizeof(product));
    case HID_STRING_ID_ISERIALNUMBER:
        return CopyToRequestMemory(request, serial, sizeof(serial));
    default:
        return STATUS_INVALID_PARAMETER;
    }
}

VOID EvtHidDeviceControl(WDFQUEUE queue, WDFREQUEST request, size_t outputLength, size_t inputLength, ULONG ioControlCode)
{
    UNREFERENCED_PARAMETER(outputLength);
    UNREFERENCED_PARAMETER(inputLength);
    PDEVICE_CONTEXT context = GetDeviceContext(WdfIoQueueGetDevice(queue));
    BOOLEAN complete = TRUE;
    NTSTATUS status;

    switch (ioControlCode) {
    case IOCTL_HID_GET_DEVICE_DESCRIPTOR:
        status = CopyToRequestMemory(request, &HidDescriptor, HidDescriptor.bLength);
        break;
    case IOCTL_HID_GET_DEVICE_ATTRIBUTES:
        status = CopyToRequestMemory(request, &context->HidAttributes, sizeof(HID_DEVICE_ATTRIBUTES));
        break;
    case IOCTL_HID_GET_REPORT_DESCRIPTOR:
        status = CopyToRequestMemory(request, HidReportDescriptor, sizeof(HidReportDescriptor));
        break;
    case IOCTL_HID_READ_REPORT:
        status = HidReadReport(context, request, &complete);
        break;
    case IOCTL_UMDF_HID_SET_FEATURE:
        status = HidSetFeature(context, request);
        break;
    case IOCTL_HID_GET_STRING:
        status = HidGetString(request);
        break;
    case IOCTL_HID_WRITE_REPORT:            // no output reports: rumble goes through XInput
    case IOCTL_UMDF_HID_SET_OUTPUT_REPORT:
    case IOCTL_UMDF_HID_GET_FEATURE:
    case IOCTL_UMDF_HID_GET_INPUT_REPORT:
    case IOCTL_HID_GET_INDEXED_STRING:
    case IOCTL_HID_ACTIVATE_DEVICE:
    case IOCTL_HID_DEACTIVATE_DEVICE:
    case IOCTL_HID_SEND_IDLE_NOTIFICATION_REQUEST:
    case IOCTL_GET_PHYSICAL_DESCRIPTOR:
    default:
        status = STATUS_NOT_IMPLEMENTED;
        break;
    }
    if (complete) {
        WdfRequestComplete(request, status);
    }
}


//
// XUSB device
//

// the state as XInput's GET_STATE answers it
static void BuildXusbState(PDEVICE_CONTEXT context, XUSB_STATE_0101* state)
{
    RtlZeroMemory(state, sizeof(*state));
    state->Version = XUSB_VERSION;
    state->Status = 1;      // connected
    state->PacketNumber = context->PacketNumber;
    FillXusbGamepad(&context->State, &state->Gamepad);
}

// answers one pending Windows.Gaming.Input input request with the current
// state: the same layout, with the markers its input parser checks
static BOOLEAN CompletePendingInput(PDEVICE_CONTEXT context)
{
    WDFREQUEST request;
    if (!NT_SUCCESS(WdfIoQueueRetrieveNextRequest(context->ReadQueue, &request))) {
        return FALSE;
    }
    XUSB_STATE_0101 state;
    BuildXusbState(context, &state);
    state.Status = 3;           // input resumed
    state.Unknown5 = 0x14;      // the size of an XInput report: without it the input is skipped
    WdfRequestComplete(request, CopyToRequestBuffer(request, &state, sizeof(state)));
    return TRUE;
}

// answers a wait for the output with the current one
static void CompleteOutputWait(PDEVICE_CONTEXT context, WDFREQUEST request)
{
    EASYCONTROL_PAD_OUTPUT_EVENT event;
    event.Serial = context->OutputSerial;
    event.Output = context->Output;
    WdfRequestComplete(request, CopyToRequestBuffer(request, &event, sizeof(event)));
}

// the output changed: every pending wait gets it
static void CompleteOutputWaits(PDEVICE_CONTEXT context)
{
    WDFREQUEST request;
    while (NT_SUCCESS(WdfIoQueueRetrieveNextRequest(context->OutputQueue, &request))) {
        CompleteOutputWait(context, request);
    }
}

static VOID EvtXusbInputTimer(WDFTIMER timer)
{
    CompletePendingInput(GetDeviceContext((WDFDEVICE)WdfTimerGetParentObject(timer)));
}

VOID EvtXusbDeviceControl(WDFQUEUE queue, WDFREQUEST request, size_t outputLength, size_t inputLength, ULONG ioControlCode)
{
    UNREFERENCED_PARAMETER(inputLength);
    PDEVICE_CONTEXT context = GetDeviceContext(WdfIoQueueGetDevice(queue));
    NTSTATUS status;
    PVOID input;

    switch (ioControlCode) {
    case XUSB_IOCTL_WAIT_FOR_INPUT:
        // kept until the state changes, or the timer answers it
        status = WdfRequestForwardToIoQueue(request, context->ReadQueue);
        if (NT_SUCCESS(status)) {
            if (context->HasNewState && CompletePendingInput(context)) {
                context->HasNewState = FALSE;
            }
            return;
        }
        break;
    case XUSB_IOCTL_GET_INFORMATION_EX: {
        UCHAR info[64] = { 0 };
        *(UINT16*)&info[0] = XUSB_VERSION;
        info[2] = 1;
        info[3] = 1;
        *(UINT16*)&info[8] = EASYCONTROL_PAD_VID;
        *(UINT16*)&info[10] = EASYCONTROL_PAD_PID;
        status = CopyToRequestBuffer(request, info, outputLength < sizeof(info) ? outputLength : sizeof(info));
        break;
    }
    case XUSB_IOCTL_POWER_INFORMATION:
        status = STATUS_SUCCESS;
        break;
    case XUSB_IOCTL_GET_INFORMATION: {
        XUSB_INFORMATION info = { 0 };
        info.Version = XUSB_VERSION;
        info.DeviceCount = 1;
        info.VendorId = EASYCONTROL_PAD_VID;
        info.ProductId = EASYCONTROL_PAD_PID;
        status = CopyToRequestBuffer(request, &info, sizeof(info));
        break;
    }
    case XUSB_IOCTL_GET_STATE:
        if (outputLength >= sizeof(XUSB_STATE_0101)) {
            XUSB_STATE_0101 state;
            BuildXusbState(context, &state);
            status = CopyToRequestBuffer(request, &state, sizeof(state));
        } else {
            XUSB_STATE_0100 state = { 0 };
            state.Status = 1;
            state.PacketNumber = context->PacketNumber;
            FillXusbGamepad(&context->State, &state.Gamepad);
            status = CopyToRequestBuffer(request, &state, sizeof(state));
        }
        break;
    case XUSB_IOCTL_GET_CAPABILITIES:
        if (outputLength >= sizeof(XUSB_CAPABILITIES_0102)) {
            XUSB_CAPABILITIES_0102 caps = { 0 };
            caps.Version = XUSB_VERSION;
            caps.Type = XINPUT_DEVTYPE_GAMEPAD;
            caps.SubType = XINPUT_DEVSUBTYPE_GAMEPAD;
            // the values of a wired Xbox 360 pad's answer
            caps.Flags = 0x000C;
            caps.VendorId = EASYCONTROL_PAD_VID;
            caps.ProductId = EASYCONTROL_PAD_PID;
            caps.ProductVersion = 0x0110;
            caps.Unknown3 = 0x2234FA00;
            caps.Gamepad = XusbFullCapabilities;
            caps.Unknown4 = 0xFFFFFFFF;
            caps.LeftMotor = 0xFF;
            caps.RightMotor = 0xFF;
            status = CopyToRequestBuffer(request, &caps, sizeof(caps));
        } else {
            XUSB_CAPABILITIES_0101 caps = { 0 };
            caps.Version = XUSB_VERSION;
            caps.Type = XINPUT_DEVTYPE_GAMEPAD;
            caps.SubType = XINPUT_DEVSUBTYPE_GAMEPAD;
            caps.Gamepad = XusbFullCapabilities;
            caps.LeftMotor = 0xFF;
            caps.RightMotor = 0xFF;
            status = CopyToRequestBuffer(request, &caps, sizeof(caps));
        }
        break;
    case XUSB_IOCTL_GET_LED_STATE: {
        XUSB_LED_STATE led = { XUSB_VERSION, context->Output.LedState };
        status = CopyToRequestBuffer(request, &led, sizeof(led));
        break;
    }
    case XUSB_IOCTL_SET_STATE:
        status = WdfRequestRetrieveInputBuffer(request, sizeof(XUSB_SET_STATE), &input, NULL);
        if (NT_SUCCESS(status)) {
            const XUSB_SET_STATE* set = (const XUSB_SET_STATE*)input;
            const EASYCONTROL_PAD_OUTPUT before = context->Output;
            if (set->Flags & XUSB_SET_STATE_FLAG_LED) {
                context->Output.LedState = set->LedState;
            }
            if (set->Flags & XUSB_SET_STATE_FLAG_VIBRATION) {
                context->Output.LeftMotor = set->LeftMotor;
                context->Output.RightMotor = set->RightMotor;
            }
            if (memcmp(&before, &context->Output, sizeof(before)) != 0) {
                context->OutputSerial++;
                CompleteOutputWaits(context);
            }
        }
        break;
    case XUSB_IOCTL_GET_BATTERY_INFORMATION: {
        XUSB_BATTERY_INFORMATION battery = { XUSB_VERSION, BATTERY_TYPE_WIRED, BATTERY_LEVEL_FULL };
        status = CopyToRequestBuffer(request, &battery, sizeof(battery));
        break;
    }
    case XUSB_IOCTL_POWER_DOWN:
        status = STATUS_SUCCESS;
        break;

    case EASYCONTROL_IOCTL_SET_STATE:
        status = WdfRequestRetrieveInputBuffer(request, sizeof(EASYCONTROL_PAD_STATE), &input, NULL);
        if (NT_SUCCESS(status)) {
            if (memcmp(&context->State, input, sizeof(EASYCONTROL_PAD_STATE)) != 0) {
                memcpy(&context->State, input, sizeof(EASYCONTROL_PAD_STATE));
                context->PacketNumber++;
                context->HasNewState = !CompletePendingInput(context);
            }
        }
        break;
    case EASYCONTROL_IOCTL_GET_OUTPUT:
        status = CopyToRequestBuffer(request, &context->Output, sizeof(context->Output));
        break;
    case EASYCONTROL_IOCTL_GET_VERSION: {
        EASYCONTROL_PAD_VERSION_INFO info;
        info.Version = EASYCONTROL_PAD_VERSION;
        info.Features = EASYCONTROL_PAD_FEATURE_OUTPUT_POLL | EASYCONTROL_PAD_FEATURE_OUTPUT_WAIT;
        status = CopyToRequestBuffer(request, &info, sizeof(info));
        break;
    }
    case EASYCONTROL_IOCTL_WAIT_OUTPUT:
        // answered at once when the output changed since the serial the
        // addon saw, else kept until it does (cancelled with its handle)
        status = WdfRequestRetrieveInputBuffer(request, sizeof(UINT32), &input, NULL);
        if (NT_SUCCESS(status)) {
            if (*(const UINT32*)input != context->OutputSerial) {
                CompleteOutputWait(context, request);
                return;
            }
            status = WdfRequestForwardToIoQueue(request, context->OutputQueue);
            if (NT_SUCCESS(status)) {
                return;
            }
        }
        break;

    // XInput falls back to polling the state when these are refused
    case XUSB_IOCTL_WAIT_FOR_GUIDE_BUTTON:
    case XUSB_IOCTL_GET_AUDIO_INFORMATION:
    default:
        status = STATUS_INVALID_DEVICE_REQUEST;
        break;
    }
    WdfRequestComplete(request, status);
}


//
// driver and device creation
//

// true when the device's hardware IDs name the HID device
static BOOLEAN IsHidDevice(PWDFDEVICE_INIT deviceInit)
{
    WDFMEMORY memory;
    BOOLEAN isHid = FALSE;
    // the pool type means nothing in user mode
    if (!NT_SUCCESS(WdfFdoInitAllocAndQueryProperty(deviceInit, DevicePropertyHardwareID, NonPagedPool,
            WDF_NO_OBJECT_ATTRIBUTES, &memory))) {
        return FALSE;
    }
    size_t length;
    PCWSTR ids = (PCWSTR)WdfMemoryGetBuffer(memory, &length);
    const size_t count = length / sizeof(WCHAR);
    // a REG_MULTI_SZ: strings one after the other, an empty one at the end
    for (size_t i = 0; i < count && ids[i] != L'\0'; i += wcsnlen(ids + i, count - i) + 1) {
        if (_wcsicmp(ids + i, EASYCONTROL_HID_HARDWARE_ID) == 0) {
            isHid = TRUE;
            break;
        }
    }
    WdfObjectDelete(memory);
    return isHid;
}

NTSTATUS EvtDeviceAdd(WDFDRIVER driver, PWDFDEVICE_INIT deviceInit)
{
    UNREFERENCED_PARAMETER(driver);
    const BOOLEAN isHid = IsHidDevice(deviceInit);
    if (isHid) {
        // below mshidumdf.sys, which is the function driver
        WdfFdoInitSetFilter(deviceInit);
    }

    // one callback at a time per device: no locks around the state
    WDF_OBJECT_ATTRIBUTES attributes;
    WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&attributes, DEVICE_CONTEXT);
    attributes.SynchronizationScope = WdfSynchronizationScopeDevice;
    WDFDEVICE device;
    NTSTATUS status = WdfDeviceCreate(&deviceInit, &attributes, &device);
    if (!NT_SUCCESS(status)) {
        return status;
    }
    PDEVICE_CONTEXT context = GetDeviceContext(device);
    RtlZeroMemory(context, sizeof(DEVICE_CONTEXT));
    context->IsHid = isHid;

    WDF_IO_QUEUE_CONFIG queueConfig;
    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&queueConfig, WdfIoQueueDispatchParallel);
    queueConfig.EvtIoDeviceControl = isHid ? EvtHidDeviceControl : EvtXusbDeviceControl;
    status = WdfIoQueueCreate(device, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, WDF_NO_HANDLE);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    // pending reads (HID) or input requests (XUSB); the first gets the
    // resting state at once
    context->HasNewState = TRUE;
    WDF_IO_QUEUE_CONFIG_INIT(&queueConfig, WdfIoQueueDispatchManual);
    status = WdfIoQueueCreate(device, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, &context->ReadQueue);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    if (isHid) {
        context->HidAttributes.Size = sizeof(HID_DEVICE_ATTRIBUTES);
        context->HidAttributes.VendorID = EASYCONTROL_PAD_VID;
        context->HidAttributes.ProductID = EASYCONTROL_PAD_PID;
        context->HidAttributes.VersionNumber = EASYCONTROL_PAD_PRODUCT_VERSION;
        return STATUS_SUCCESS;
    }

    // the addon's waits for the output (rumble)
    WDF_IO_QUEUE_CONFIG_INIT(&queueConfig, WdfIoQueueDispatchManual);
    status = WdfIoQueueCreate(device, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, &context->OutputQueue);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    WDF_TIMER_CONFIG timerConfig;
    WDF_TIMER_CONFIG_INIT_PERIODIC(&timerConfig, EvtXusbInputTimer, XUSB_INPUT_PERIOD_MS);
    WDF_OBJECT_ATTRIBUTES timerAttributes;
    WDF_OBJECT_ATTRIBUTES_INIT(&timerAttributes);
    timerAttributes.ParentObject = device;
    WDFTIMER timer;
    status = WdfTimerCreate(&timerConfig, &timerAttributes, &timer);
    if (!NT_SUCCESS(status)) {
        return status;
    }
    WdfTimerStart(timer, WDF_REL_TIMEOUT_IN_MS(XUSB_INPUT_PERIOD_MS));
    return WdfDeviceCreateDeviceInterface(device, &EASYCONTROL_GUID_DEVINTERFACE_XUSB, NULL);
}

NTSTATUS DriverEntry(PDRIVER_OBJECT driverObject, PUNICODE_STRING registryPath)
{
    WDF_DRIVER_CONFIG config;
    WDF_DRIVER_CONFIG_INIT(&config, EvtDeviceAdd);
    return WdfDriverCreate(driverObject, registryPath, WDF_NO_OBJECT_ATTRIBUTES, &config, WDF_NO_HANDLE);
}
