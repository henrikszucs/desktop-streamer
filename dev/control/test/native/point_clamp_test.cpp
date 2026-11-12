// Checks src/native/point_clamp.h, where macOS keeps the pointer on a screen,
// on layouts no runner has. Built and run by `npm run test:native`.

#include "../../src/native/point_clamp.h"

#include <cstdio>
#include <vector>

using PointClamp::Point;
using PointClamp::Rect;

static int failures = 0;

static void Check(const char* name, const std::vector<Rect>& screens, Point point, Point expected) {
    const Point got = PointClamp::Clamp(screens.data(), screens.size(), point);
    const bool isOk = got.x == expected.x && got.y == expected.y;
    std::printf("%s %s", isOk ? "ok    " : "FAILED", name);
    if (!isOk) {
        std::printf(": got %g,%g, expected %g,%g", got.x, got.y, expected.x, expected.y);
        failures++;
    }
    std::printf("\n");
}

int main() {
    const std::vector<Rect> one = {{0, 0, 1440, 900}};
    Check("on the screen: as it is, fractions too", one, {300.3, 300.7}, {300.3, 300.7});
    Check("the top left corner is on the screen", one, {0, 0}, {0, 0});
    Check("past the last whole point, still on the screen", one, {1439.5, 899.5}, {1439.5, 899.5});
    Check("the right edge itself is off the screen", one, {1440, 300}, {1439, 300});
    Check("the bottom edge itself is off the screen", one, {300, 900}, {300, 899});
    Check("far past the corner", one, {99999, 99999}, {1439, 899});
    Check("before the corner", one, {-500, -500}, {0, 0});
    Check("off one side keeps the other axis's fraction", one, {-500, 300.5}, {0, 300.5});
    Check("off the bottom keeps the other axis's fraction", one, {300.25, 5000}, {300.25, 899});
    Check("no screens: as it is", {}, {-5, 5}, {-5, 5});

    const std::vector<Rect> leftOfPrimary = {{0, 0, 1440, 900}, {-1920, -100, 1920, 1080}};
    Check("on a screen with negative coordinates", leftOfPrimary, {-1000.5, -50.25}, {-1000.5, -50.25});
    Check("past the left screen's left", leftOfPrimary, {-3000, 300}, {-1920, 300});
    Check("above the left screen", leftOfPrimary, {-1000, -500}, {-1000, -100});
    Check("just left of the primary is on the left screen", leftOfPrimary, {-0.5, 300}, {-0.5, 300});
    Check("level with the taller screen only, on it", leftOfPrimary, {-10, 950}, {-10, 950});
    Check("below the shorter one, under it", leftOfPrimary, {700, 950}, {700, 899});

    const std::vector<Rect> stacked = {{0, 0, 1440, 900}, {100, -1080, 1920, 1080}};
    Check("on the screen above", stacked, {500, -500}, {500, -500});
    Check("beside the upper screen, past its right", stacked, {3000, -500}, {2019, -500});
    Check("left of the upper screen, nearest is its edge", stacked, {50, -500}, {100, -500});

    // side by side with a gap, as screens of different heights leave at a corner
    const std::vector<Rect> gap = {{0, 0, 1000, 1000}, {1000, 0, 1000, 500}};
    Check("in the gap under the shorter screen, it is nearest", gap, {1500, 600}, {1500, 499});
    Check("in the gap beside the taller one, it is nearest", gap, {1010, 900}, {999, 900});

    const std::vector<Rect> diagonal = {{0, 0, 1000, 1000}, {1000, 1000, 1000, 1000}};
    Check("between screens touching at a corner", diagonal, {1100, 900}, {1100, 1000});
    Check("the same distance to both: the first", diagonal, {1499, 500}, {999, 500});

    if (failures == 0) {
        std::printf("\nall passed\n");
    } else {
        std::printf("\n%d FAILED\n", failures);
    }
    return failures == 0 ? 0 : 1;
}
