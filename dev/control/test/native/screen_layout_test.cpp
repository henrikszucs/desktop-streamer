// Checks src/native/screen_layout.h, the Windows monitor layout that matches
// Electron's screen API, on set-ups no single test machine has. Built and run
// by `npm run test:native`. Each expected value is worked out from Chromium's
// rules in the comment beside it.

#include "../../src/native/screen_layout.h"

#include <cstdio>
#include <string>
#include <vector>

using ScreenLayout::LogicalRect;
using ScreenLayout::PhysicalMonitor;

static int failures = 0;

static void Check(const char* name, const std::vector<PhysicalMonitor>& monitors, const std::vector<LogicalRect>& expected) {
    const std::vector<LogicalRect> actual = ScreenLayout::Layout(monitors);
    bool isOk = actual.size() == expected.size();
    for (size_t i = 0; isOk && i < actual.size(); i++) {
        isOk = actual[i].x == expected[i].x && actual[i].y == expected[i].y &&
            actual[i].width == expected[i].width && actual[i].height == expected[i].height;
    }
    std::printf("%s %s\n", isOk ? "ok    " : "FAILED", name);
    if (!isOk) {
        failures++;
        for (size_t i = 0; i < actual.size(); i++) {
            std::printf("         got {%d, %d, %d, %d}", actual[i].x, actual[i].y, actual[i].width, actual[i].height);
            if (i < expected.size()) {
                std::printf(", expected {%d, %d, %d, %d}", expected[i].x, expected[i].y, expected[i].width, expected[i].height);
            }
            std::printf("\n");
        }
    }
}

int main() {
    // one monitor: its size divided by the scale, rounded up
    Check("1280x1024 at 125% (1024 x 819.2 -> 820, as Electron reports on the dev machine)",
        { {0, 0, 1280, 1024, 1.25f} }, { {0, 0, 1024, 820} });
    Check("1920x1080 at 125% (exactly 1536 x 864 in float, not rounded up to 1537)",
        { {0, 0, 1920, 1080, 1.25f} }, { {0, 0, 1536, 864} });
    Check("3840x2160 at 150%",
        { {0, 0, 3840, 2160, 1.5f} }, { {0, 0, 2560, 1440} });
    Check("2560x1440 at 175% (1462.86 x 822.86 -> 1463 x 823)",
        { {0, 0, 2560, 1440, 1.75f} }, { {0, 0, 1463, 823} });
    Check("3840x2160 at 200%",
        { {0, 0, 3840, 2160, 2.0f} }, { {0, 0, 1920, 1080} });
    Check("1920x1080 at 100%",
        { {0, 0, 1920, 1080, 1.0f} }, { {0, 0, 1920, 1080} });

    // to the right, tops aligned: against the primary's right edge, offset
    // ScaleOffset(1080, 1, 0) = 0; its size 4480 / 1.5 = 2986.67 -> 2987 - 1280
    Check("100% primary, 150% monitor to its right",
        { {0, 0, 1920, 1080, 1.0f}, {1920, 0, 4480, 1440, 1.5f} },
        { {0, 0, 1920, 1080}, {1920, 0, 1707, 960} });

    // to the left, bottoms aligned: placed from the end, so its bottom meets
    // the primary's: y = 1152 - 0 - 1080 = 72 (not 360 / 1.25 = 288)
    Check("125% primary, 100% monitor to its left, bottoms aligned",
        { {0, 0, 2560, 1440, 1.25f}, {-1920, 360, 0, 1440, 1.0f} },
        { {0, 0, 2048, 1152}, {-1920, 72, 1920, 1080} });

    // above, part way along: offset ScaleOffset(1920, 1, 320) = 320, and
    // y = 0 - 820 (its height, 1024 / 1.25 rounded up)
    Check("100% primary, 125% monitor above it, 320 px in",
        { {0, 0, 1920, 1080, 1.0f}, {320, -1024, 1600, 0, 1.25f} },
        { {0, 0, 1920, 1080}, {320, -820, 1024, 820} });

    // a chain: B touches only A, so it is placed against A's logical edge
    Check("100% primary, 200% monitor right of it, 100% monitor right of that",
        { {0, 0, 1920, 1080, 1.0f}, {1920, 0, 5760, 2160, 2.0f}, {5760, 0, 7680, 1080, 1.0f} },
        { {0, 0, 1920, 1080}, {1920, 0, 1920, 1080}, {3840, 0, 1920, 1080} });

    // touching nothing: keeps its own scaled rectangle
    Check("a monitor touching none",
        { {0, 0, 1920, 1080, 1.0f}, {3000, 0, 4920, 1080, 1.0f} },
        { {0, 0, 1920, 1080}, {3000, 0, 1920, 1080} });

    // the primary listed second: order kept, placement from the primary
    Check("primary not first in the list",
        { {1920, 0, 4480, 1440, 1.5f}, {0, 0, 1920, 1080, 1.0f} },
        { {1920, 0, 1707, 960}, {0, 0, 1920, 1080} });

    std::printf("\n%s\n", failures == 0 ? "all passed" : (std::to_string(failures) + " failed").c_str());
    return failures == 0 ? 0 : 1;
}
