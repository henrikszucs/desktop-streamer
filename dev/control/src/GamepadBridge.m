#import "GamepadBridge.h"
#import "gamepad_implement-Swift.h"
#import <Foundation/Foundation.h>

@implementation GamepadBridge

+ (int)createGamepad {
    return [SwiftCode createGamepad];
}

+ (BOOL)destroyGamepad:(int)gamepadId {
    return [SwiftCode destroyGamepad:gamepadId];
}

+ (BOOL)buttonDown:(int)gamepadId button:(int)buttonId {
    return [SwiftCode buttonDown:gamepadId button:buttonId];
}

+ (BOOL)buttonUp:(int)gamepadId button:(int)buttonId {
    return [SwiftCode buttonUp:gamepadId button:buttonId];
}

+ (BOOL)setAxis:(int)gamepadId axis:(int)axisId value:(int)value {
    return [SwiftCode setAxis:gamepadId axis:axisId value:value];
}

@end