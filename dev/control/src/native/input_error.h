#pragma once
#ifndef INPUT_ERROR_H
#define INPUT_ERROR_H

#include <string>

// Why a key or button could not be sent: the message, and the code JS gets
// as error.code ("" for none). An empty message means it was sent. Kept apart
// from N-API, so the code that collects these can be tested on its own
// (test/native).
struct InputError {
    std::string code;
    std::string message;

    bool IsFailed() const {
        return !this->message.empty();
    }
};

#endif
