"use strict";
/**
 * from Sender
 */
[
    FROM,                          // start sender 0-client, 1-server
    ID,                             // callback id, -1 if fire and forget
    METHOD/REQUEST                // method 0> number
    //... other parameters for methods
],


/**
 * to sender
 */
[
    FROM,                   // start sender 0-client, 1-server
    ID,                     // callback id
    STATUS                 // status 0-everything is good, 400 - worng JSON syntax; 404 wrong api request negtive error;
    //... other parameters for respond
],

// Communicator class handle FROM and ID varables
// METHOD/REQUEST id identify the function

/**
 * Ping -  method 0
 */
[

],
[

]

/**
 * Login guest - method 1
 */
[
    "Guest name"
],
[
    0,                  // status 0-everything is good 401 not allowed
    "Accepted guest name #2"
]

/**
 * Login session - method 2
 */
[
    123
],
[
    0                  // status 0-everything is good 401 not allowed
]

/**
 * Login password - method 3
 */
[
    "username",         // username
    "password"          // password SHA256
],
[
    0,                 // status 0-everything is good 401 not allowed
    12323              // session id
]


/**
 * Logout - method 4
 */
[
    1234                // session id
],
[
    0,                 // status 0-everything is good 401 not allowed
]




/**
 * Listener pause - method 5
 */
[
    1234                // session id
],
[
    0                   // status 0-everything is good 401 not allowed
]


/**
 *  Listener Main page - method 6
 */
[
    1234                // session id
],
[
    0                   // status 0-everything is good 401 not allowed
]


/**
 *  Listener Room page - method 7
 */
[
    1234                // session id
],
[
    0                   // status 0-everything is good 401 not allowed
]






/**
 * Join to room
 */
[
    1234,                  // session id
    12345,                 // room id
    ["video1", "video2"],  // screens
    true,                  // system audio
    true                   // mouse and keyboard control
],

[
    0                   // 0, 401,
]


/**
 * Request Control
 */
[
    1234,               // session id
    12345,              // room id
    "video1",           // screens
    true,               // system audio
    true                // mouse and keyboard control
],
[
    0,                             // 0, 401
    "webrtc media connection",     // webrtc connection json
    "webrtc control connection"    // webrtc connection json
]









