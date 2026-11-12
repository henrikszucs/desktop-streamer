// Checks src/native/release_all.h, the loop of Keyboard.releaseAll and
// Mouse.releaseAll, with a fake send: a failed release (the secure desktop on
// Windows) cannot be provoked unattended on a real system. Built and run by
// `npm run test:native`.

#include "../../src/native/release_all.h"

#include <cstdio>
#include <set>
#include <string>
#include <vector>

static int failures = 0;

static void Check(const char* name, bool isOk) {
    std::printf("%s %s\n", isOk ? "ok    " : "FAILED", name);
    if (!isOk) {
        failures++;
    }
}

// a send that fails for the entries in `failing`, with a code naming the entry,
// and records what it was asked to send
struct FakeSend {
    std::set<std::string> failing;
    std::vector<std::string>* sent;

    InputError operator()(const std::string& entry) const {
        this->sent->push_back(entry);
        if (this->failing.count(entry) == 0) {
            return InputError();
        }
        return InputError{ "CODE_" + entry, "failed " + entry };
    }
};

int main() {
    {
        std::set<std::string> held = { "a", "b", "c" };
        std::vector<std::string> sent;
        const InputError error = ReleaseEach(held, FakeSend{ {}, &sent });
        Check("every release works: all sent, the set ends empty, no error",
            sent.size() == 3 && held.empty() && !error.IsFailed());
    }
    {
        std::set<std::string> held = { "a", "b", "c" };
        std::vector<std::string> sent;
        const InputError error = ReleaseEach(held, FakeSend{ { "b" }, &sent });
        Check("the second of three fails: all three tried",
            sent == std::vector<std::string>({ "a", "b", "c" }));
        Check("the second of three fails: only it stays held",
            held == std::set<std::string>({ "b" }));
        Check("the second of three fails: its error is returned, code included",
            error.IsFailed() && error.code == "CODE_b" && error.message == "failed b");
    }
    {
        std::set<std::string> held = { "a", "b", "c" };
        std::vector<std::string> sent;
        const InputError error = ReleaseEach(held, FakeSend{ { "a", "b", "c" }, &sent });
        Check("all fail: all tried, the set unchanged",
            sent.size() == 3 && held == std::set<std::string>({ "a", "b", "c" }));
        Check("all fail: the first failure is returned, its code kept",
            error.code == "CODE_a" && error.message == "failed a");
    }
    {
        std::set<std::string> held;
        std::vector<std::string> sent;
        const InputError error = ReleaseEach(held, FakeSend{ {}, &sent });
        Check("nothing held: nothing sent, no error", sent.empty() && !error.IsFailed());
    }
    {
        // a failure with a message but no code (macOS, Linux)
        std::set<std::string> held = { "x" };
        std::vector<std::string> sent;
        const InputError error = ReleaseEach(held, [&sent](const std::string& entry) {
            sent.push_back(entry);
            return InputError{ "", "no display" };
        });
        Check("a failure without a code is still a failure",
            error.IsFailed() && error.code.empty() && held.size() == 1);
    }

    std::printf("\n%s\n", failures == 0 ? "all passed" : (std::to_string(failures) + " failed").c_str());
    return failures == 0 ? 0 : 1;
}
