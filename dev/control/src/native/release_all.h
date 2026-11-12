#pragma once
#ifndef RELEASE_ALL_H
#define RELEASE_ALL_H

#include "input_error.h"

#include <set>
#include <string>

// What Keyboard.releaseAll and Mouse.releaseAll do with the keys or buttons
// held: every one is released with `send`, even after one fails; those that
// failed stay in `held`, so a later releaseAll (or the exit hook) can try them
// again. Returns the first failure, or an empty InputError.
template <typename Send>
InputError ReleaseEach(std::set<std::string>& held, Send send) {
    InputError first;
    for (auto it = held.begin(); it != held.end(); ) {
        const InputError error = send(*it);
        if (!error.IsFailed()) {
            it = held.erase(it);
            continue;
        }
        if (!first.IsFailed()) {
            first = error;
        }
        ++it;
    }
    return first;
}

#endif
