"use strict";


/**
 * From Client
 */
[
    123,               // callback id
    0                  // method 0-ping 1-login 2-logout, 3-switch-to-main, 4-switch-to-room
    //... other parameters for methods
]


/**
 * From Server
 */
[
    123,                // callback id
    0                   // status 0-everything is good, -400 - worng JSON syntax; -404 wrong api request negtive error; positive request;
    //... other parameters from methods
]




/**
 * Login
 */
//Guest login
[
    123,                // callback id
    1,                  // method 1-login
    0,                  // login method - guest login
    "Guest name"
],
[
    123,                // callback id
    0,                  // status 0-everything is good
    "Accepted guest name #2"
]

//Session login
[
    123,                // callback id
    1,                  // method 1-login
    1,                  // login method - session login
    123                 // session id - session login
],
[
    123,                // callback id
    0,                  // status 0-everything is good or 401 if fail
]

//Password login
[
    123,                // callback id
    1,                  // method 1-login
    2,                  // login method - password login
    "username",         // username
    "password"          // password
],
[
    123,                // callback id
    0,                  // status 0-everything is good or 401 if fail
    "username"          // username if good
]




/**
 * Logout
 */
[
    123,                // callback id
    2,                  // method 2-logout
    1234                // session id
],
[
    123,                // callback id
]




/**
 * Switch to main
 */
[
    123,                // callback id
    3                  // method 3-main page listener
],
[
    123                // callback id
]










/**
 * Switch to room
 */
[
    123,                // callback id
    4,                  // method
    12345               // room id
],

[
    123,                // callback id
    0                   // 0, -401, -102 processing
]
[
    123,                // callback id
    0                   // 0, -401, -102 processing
    [
        [clientID, "user", [true, ["video1", "video2"], true]]
    ]
]



/**
 * Access to control
 */
[
    123,                // callback id
    5,                  // method
    12345,              // room id
    12356,              // client id
    true,               // system audio
    "video1",           // screen
    true                //mouse
],

[
    123,                // callback id
    0                   // 0, -401, -102 processing
]

[
    123,                    // callback id
    0,                      // 0, -401, -102 processing
    "webrtc connection"     // webrtc connection json
]









