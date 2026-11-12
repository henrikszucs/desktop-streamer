#pragma once
#ifndef POINT_CLAMP_H
#define POINT_CLAMP_H

// macOS: keeps a point the pointer is sent to on a screen. A posted event is
// not clamped by the system, and reading the position back after one gives
// its raw coordinates. Pure arithmetic, kept apart from the display calls so
// test/native/point_clamp_test.cpp can check it on layouts no machine at hand
// has: negative coordinates, screens of different sizes, gaps between them.

#include <algorithm>
#include <cstddef>

namespace PointClamp {

struct Point {
    double x;
    double y;
};

struct Rect {
    double x;
    double y;
    double width;
    double height;
};

// the point itself when on a screen (right and bottom exclusive), else the
// nearest point of the nearest screen, on its last whole point at the right
// and bottom; with no screens, the point
inline Point Clamp(const Rect* screens, size_t count, Point point) {
    Point best = point;
    double bestDistance = -1;
    for (size_t i = 0; i < count; i++) {
        const Rect& s = screens[i];
        const double right = s.x + s.width;
        const double bottom = s.y + s.height;
        if (point.x >= s.x && point.x < right && point.y >= s.y && point.y < bottom) {
            return point;
        }
        const Point clamped = {
            std::min(std::max(point.x, s.x), right - 1),
            std::min(std::max(point.y, s.y), bottom - 1)
        };
        const double dx = clamped.x - point.x;
        const double dy = clamped.y - point.y;
        const double distance = dx * dx + dy * dy;
        if (bestDistance < 0 || distance < bestDistance) {
            bestDistance = distance;
            best = clamped;
        }
    }
    return best;
}

}

#endif
