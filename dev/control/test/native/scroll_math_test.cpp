// Checks src/native/scroll_math.h, the notches Mouse.scroll sends on Wayland
// beside the high-resolution wheel, which no runner can show. Built and run
// by `npm run test:native`. Amounts in 120ths of a notch, as AddWheel takes
// them.

#include "../../src/native/scroll_math.h"

#include <cstdio>
#include <string>
#include <vector>

static int failures = 0;

static void Check(const char* name, bool isOk) {
    std::printf("%s %s\n", isOk ? "ok    " : "FAILED", name);
    if (!isOk) {
        failures++;
    }
}

// the notches of each call, from a total of `start`
static std::vector<long> Notches(long start, const std::vector<long>& wheels) {
    long total = start;
    std::vector<long> notches;
    for (long wheel : wheels) {
        notches.push_back(AddWheel(total, wheel));
    }
    return notches;
}

// the same without the wrap of the total, in 64 bits
static std::vector<long> NotchesUnwrapped(long long start, const std::vector<long>& wheels) {
    const auto floorDiv = [](long long a, long long b) {
        const long long quotient = a / b;
        return (a % b != 0 && ((a < 0) != (b < 0))) ? quotient - 1 : quotient;
    };
    long long total = start;
    std::vector<long> notches;
    for (long wheel : wheels) {
        notches.push_back((long)(floorDiv(total + wheel, 120) - floorDiv(total, 120)));
        total += wheel;
    }
    return notches;
}

int main() {
    Check("FloorDiv rounds down", FloorDiv(7, 2) == 3 && FloorDiv(-7, 2) == -4 && FloorDiv(-6, 2) == -3 &&
        FloorDiv(0, 120) == 0 && FloorDiv(-1, 120) == -1 && FloorDiv(119, 120) == 0);

    Check("+60 then -120: no notch, then one back (truncating division gave none)",
        Notches(0, { 60, -120 }) == std::vector<long>({ 0, -1 }));
    Check("+120: one notch", Notches(0, { 120 }) == std::vector<long>({ 1 }));
    Check("-120: one notch back", Notches(0, { -120 }) == std::vector<long>({ -1 }));
    {
        std::vector<long> halves(240, 60);
        long sum = 0;
        for (long notch : Notches(0, halves)) {
            sum += notch;
        }
        Check("240 calls of +60: 120 notches", sum == 120);
    }
    Check("+60, -60, +60, -60: never across a multiple of 120, no notch",
        Notches(0, { 60, -60, 60, -60 }) == std::vector<long>({ 0, 0, 0, 0 }));
    Check("-60, +60: one back, then forward again across 0",
        Notches(0, { -60, 60 }) == std::vector<long>({ -1, 1 }));

    // across the wrap of the total, as without it
    const std::vector<long> steps = { 1, 60, 119, 120, -1, -240, 37, 500, -1000, 240 };
    Check("from 119999 up across the wrap, as without it",
        Notches(119999, steps) == NotchesUnwrapped(119999, steps));
    Check("from -119999 down across the wrap, as without it",
        Notches(-119999, { -1, -60, -119, 120, 1 }) == NotchesUnwrapped(-119999, { -1, -60, -119, 120, 1 }));
    {
        long total = 0;
        for (int i = 0; i < 100000; i++) {
            AddWheel(total, 120);
        }
        Check("the total stays within 1000 notches", total > -120000 && total < 120000);
    }

    std::printf("\n%s\n", failures == 0 ? "all passed" : (std::to_string(failures) + " failed").c_str());
    return failures == 0 ? 0 : 1;
}
