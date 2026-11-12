#ifndef GAMEPAD_BRIDGE_H
#define GAMEPAD_BRIDGE_H

#import <Foundation/Foundation.h>

@interface GamepadBridge : NSObject
// the id, or -1 unavailable, -3 the activation did not finish in time
+ (int)createGamepad;
+ (BOOL)destroyGamepad:(int)gamepadId;
+ (BOOL)buttonDown:(int)gamepadId button:(int)buttonId;
+ (BOOL)buttonUp:(int)gamepadId button:(int)buttonId;
+ (BOOL)setAxis:(int)gamepadId axis:(int)axisId value:(int)value;
+ (BOOL)setTrigger:(int)gamepadId button:(int)buttonId value:(int)value pressed:(BOOL)isPressed;
+ (BOOL)beginUpdate:(int)gamepadId;
+ (BOOL)endUpdate:(int)gamepadId;
@end

#endif