#import "GamepadBridge.h"
#import "gamepad_implement-Swift.h"
#import <Foundation/Foundation.h>

@implementation GamepadBridge

+ (int)createGamepad {
    return (int)[SwiftCode createGamepad];
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

+ (BOOL)setTrigger:(int)gamepadId button:(int)buttonId value:(int)value pressed:(BOOL)isPressed {
    return [SwiftCode setTrigger:gamepadId button:buttonId value:value pressed:isPressed];
}

+ (BOOL)beginUpdate:(int)gamepadId {
    return [SwiftCode beginUpdate:gamepadId];
}

+ (BOOL)endUpdate:(int)gamepadId {
    return [SwiftCode endUpdate:gamepadId];
}

@end