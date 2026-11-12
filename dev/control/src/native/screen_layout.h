#pragma once
#ifndef SCREEN_LAYOUT_H
#define SCREEN_LAYOUT_H

// Windows: lays monitors of different scales out in one logical coordinate
// space, as Chromium does for Electron's screen API (ui/display/win/
// screen_win.cc, scaling_util.cc, display_layout.cc), so Screen.list() and
// Electron agree to the pixel. Pure arithmetic, kept apart from the Win32
// calls so test/native/screen_layout_test.cpp can check it on any set-up.
//
// Chromium computes in float, not double; so does this, because the
// rounding of float products (1920 * (1 / 1.25f) is exactly 1536, as a
// float) decides between two pixels.
//
// Not copied: Chromium's pass that pushes apart displays rounding made
// overlap (DeIntersectDisplays), and the order std::partition leaves touching
// monitors in, which decides the parent of a monitor touching two placed
// ones; both matter only for unusual set-ups of three or more monitors.

#include <algorithm>
#include <cmath>
#include <vector>

namespace ScreenLayout {

// a monitor in physical pixels: right and bottom exclusive
struct PhysicalMonitor {
    int left;
    int top;
    int right;
    int bottom;
    float scale;    // effective DPI / 96
};

// its place in the logical space
struct LogicalRect {
    int x;
    int y;
    int width;
    int height;
};

namespace detail {

inline bool InRange(int target, int lower, int upper) {
    return lower <= target && target <= upper;
}

// gfx::ScaleToEnclosingRect(rect, 1 / scale): left and top rounded down,
// right and bottom up
inline LogicalRect Enclosing(const PhysicalMonitor& m) {
    if (m.scale == 1.0f) {
        return { m.left, m.top, m.right - m.left, m.bottom - m.top };
    }
    const float inverse = 1.0f / m.scale;
    const int x = (int)std::floor((float)m.left * inverse);
    const int y = (int)std::floor((float)m.top * inverse);
    const int right = m.right == m.left ? x : (int)std::ceil((float)m.right * inverse);
    const int bottom = m.bottom == m.top ? y : (int)std::ceil((float)m.bottom * inverse);
    return { x, y, right - x, bottom - y };
}

// DisplayInfosTouch: sharing part of an edge, or a corner
inline bool Touch(const PhysicalMonitor& a, const PhysicalMonitor& b) {
    const int maxLeft = std::max(a.left, b.left);
    const int maxTop = std::max(a.top, b.top);
    const int minRight = std::min(a.right, b.right);
    const int minBottom = std::min(a.bottom, b.bottom);
    return (maxLeft == minRight && a.top <= b.bottom && b.top <= a.bottom) ||
           (maxTop == minBottom && a.left <= b.right && b.left <= a.right);
}

enum class Position { Top, Right, Bottom, Left };

// CalculateDisplayPosition: which side of the parent the monitor is on
inline Position Side(const PhysicalMonitor& parent, const PhysicalMonitor& current) {
    const int maxLeft = std::max(parent.left, current.left);
    const int maxTop = std::max(parent.top, current.top);
    const int minRight = std::min(parent.right, current.right);
    const int minBottom = std::min(parent.bottom, current.bottom);
    if (maxLeft == minRight && maxTop == minBottom) {
        // a corner only
        if (parent.bottom == maxTop) {
            return Position::Bottom;
        }
        if (parent.left == maxLeft) {
            return Position::Left;
        }
        return Position::Top;
    }
    if (maxLeft == minRight && parent.top <= current.bottom && current.top <= parent.bottom) {
        return parent.left == maxLeft ? Position::Left : Position::Right;
    }
    return parent.top == maxTop ? Position::Top : Position::Bottom;
}

// ScaleOffset: an offset along the parent's edge, in its logical pixels
inline int ScaleOffset(int length, float scale, int offset) {
    const float scaledLength = (float)length / scale;
    const float percent = (float)offset / (float)length;
    return (int)std::floor(scaledLength * percent);
}

struct Placement {
    size_t parent;
    size_t current;
    Position position;
    bool isFromEnd;     // offset from the bottom/right end (BOTTOM_RIGHT)
    int offset;
};

// CalculateDisplayPlacement
inline Placement Place(const std::vector<PhysicalMonitor>& monitors, size_t parentIndex, size_t currentIndex) {
    const PhysicalMonitor& parent = monitors[parentIndex];
    const PhysicalMonitor& current = monitors[currentIndex];
    Placement placement = { parentIndex, currentIndex, Side(parent, current), false, 0 };

    const bool isHorizontalEdge = placement.position == Position::Top || placement.position == Position::Bottom;
    int parentBegin = isHorizontalEdge ? parent.left : parent.top;
    int parentEnd = isHorizontalEdge ? parent.right : parent.bottom;
    int currentBegin = isHorizontalEdge ? current.left : current.top;
    int currentEnd = isHorizontalEdge ? current.right : current.bottom;

    // offsets relative to the parent's start
    parentEnd -= parentBegin;
    currentBegin -= parentBegin;
    currentEnd -= parentBegin;
    parentBegin = 0;

    if (parentEnd == currentEnd && parentBegin != currentBegin) {
        placement.isFromEnd = true;
        placement.offset = 0;
    } else if (InRange(currentBegin, parentBegin, parentEnd)) {
        placement.offset = ScaleOffset(parentEnd, parent.scale, currentBegin);
    } else if (InRange(currentEnd, parentBegin, parentEnd)) {
        placement.isFromEnd = true;
        placement.offset = ScaleOffset(parentEnd, parent.scale, parentEnd - currentEnd);
    } else {
        placement.offset = ScaleOffset(currentEnd - currentBegin, current.scale, currentBegin);
    }
    return placement;
}

// DisplayLayout::ApplyDisplayPlacement, with no minimum overlap
inline void Apply(const Placement& placement, std::vector<LogicalRect>& rects) {
    const LogicalRect parent = rects[placement.parent];
    LogicalRect& target = rects[placement.current];
    int offset = placement.offset;
    if (placement.position == Position::Top || placement.position == Position::Bottom) {
        if (placement.isFromEnd) {
            offset = parent.width - offset - target.width;
        }
        offset = std::max(std::min(offset, parent.width), -target.width);
    } else {
        if (placement.isFromEnd) {
            offset = parent.height - offset - target.height;
        }
        offset = std::max(std::min(offset, parent.height), -target.height);
    }
    switch (placement.position) {
        case Position::Top:
            target.x = parent.x + offset;
            target.y = parent.y - target.height;
            break;
        case Position::Right:
            target.x = parent.x + parent.width;
            target.y = parent.y + offset;
            break;
        case Position::Bottom:
            target.x = parent.x + offset;
            target.y = parent.y + parent.height;
            break;
        case Position::Left:
            target.x = parent.x - target.width;
            target.y = parent.y + offset;
            break;
    }
}

}  // namespace detail

// The logical rectangle of each monitor, in the same order. The primary
// monitor is the one at the physical origin; a monitor that touches no
// placed one keeps its own scaled rectangle, as in Chromium.
inline std::vector<LogicalRect> Layout(const std::vector<PhysicalMonitor>& monitors) {
    std::vector<LogicalRect> rects;
    for (const PhysicalMonitor& monitor : monitors) {
        rects.push_back(detail::Enclosing(monitor));
    }
    size_t primary = monitors.size();
    for (size_t i = 0; i < monitors.size(); i++) {
        if (monitors[i].left == 0 && monitors[i].top == 0) {
            primary = i;
            break;
        }
    }
    if (primary == monitors.size()) {
        return rects;
    }

    // DisplayInfosToScreenWinDisplays: a tree from the primary monitor, each
    // monitor placed against the first placed one it touches (parents taken
    // last in, first out)
    std::vector<size_t> remaining;
    for (size_t i = 0; i < monitors.size(); i++) {
        if (i != primary) {
            remaining.push_back(i);
        }
    }
    std::vector<detail::Placement> placements;
    std::vector<size_t> parents = { primary };
    while (!parents.empty()) {
        const size_t parent = parents.back();
        parents.pop_back();
        std::vector<size_t> notTouching;
        for (size_t index : remaining) {
            if (detail::Touch(monitors[parent], monitors[index])) {
                placements.push_back(detail::Place(monitors, parent, index));
                parents.push_back(index);
            } else {
                notTouching.push_back(index);
            }
        }
        remaining = notTouching;
    }
    for (const detail::Placement& placement : placements) {
        detail::Apply(placement, rects);
    }
    return rects;
}

}  // namespace ScreenLayout

#endif
