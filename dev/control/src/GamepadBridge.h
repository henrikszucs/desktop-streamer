#ifndef GAMEPAD_BRIDGE_H
#define GAMEPAD_BRIDGE_H

#import <Foundation/Foundation.h>

@interface GamepadBridge : NSObject
+ (int)createGamepad;
+ (BOOL)destroyGamepad:(int)gamepadId;
+ (BOOL)buttonDown:(int)gamepadId button:(int)buttonId;
+ (BOOL)buttonUp:(int)gamepadId button:(int)buttonId;
+ (BOOL)setAxis:(int)gamepadId axis:(int)axisId value:(int)value;
@end

#endif