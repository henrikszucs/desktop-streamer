#pragma once
#ifndef SCROLL_MATH_H
#define SCROLL_MATH_H

// The arithmetic of Mouse.scroll on Wayland, kept apart from the system calls
// so test/native can check it on every platform.

// in 120ths of a notch, as the high-resolution wheel counts
static const long WHEEL_NOTCH = 120;

// a / b rounded down (C++ division rounds toward 0)
inline long FloorDiv(long a, long b) {
    const long quotient = a / b;
    return (a % b != 0 && ((a < 0) != (b < 0))) ? quotient - 1 : quotient;
}

// Adds `wheel` (120ths of a notch) to the running total and returns the whole
// notches it completes for readers of the plain wheel: one each time the total
// crosses a multiple of 120, either way - so +60 then -120 is a notch back.
// The total is kept within 1000 notches either way; that is a multiple of 120,
// so the crossings stay where they were.
inline long AddWheel(long& total, long wheel) {
    const long notches = FloorDiv(total + wheel, WHEEL_NOTCH) - FloorDiv(total, WHEEL_NOTCH);
    total = (total + wheel) % (WHEEL_NOTCH * 1000);
    return notches;
}

#endif
