"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { clientAddress, addressOf, addressKeys, expandIPv6, holdAddress, releaseAddress, CONNECTION_MAX, CONNECTION_MAX_WIDE } from "../src/server/ws/address.js";

// the upgrade request as ws hands it to the connection listener
const buildRequest = function(remoteAddress, forwardedFor) {
    const headers = {};
    if (typeof forwardedFor !== "undefined") {
        headers["x-forwarded-for"] = forwardedFor;
    }
    return {"socket": {"remoteAddress": remoteAddress}, "headers": headers};
};

//
// where a connection came from
//
test("without a proxy the socket is the client and the header is ignored", () => {
    assert.equal(clientAddress(buildRequest("198.51.100.7"), false), "198.51.100.7");
    assert.equal(clientAddress(buildRequest("198.51.100.7", "203.0.113.1"), false), "198.51.100.7");
});

test("behind a proxy the address is the last one the proxy forwarded", () => {
    assert.equal(clientAddress(buildRequest("127.0.0.1", "203.0.113.1"), true), "203.0.113.1");

    // what the client wrote into the header itself stands to the left of what
    // the proxy appended, and is never read
    assert.equal(clientAddress(buildRequest("127.0.0.1", "10.0.0.1, 203.0.113.1"), true), "203.0.113.1");
    assert.equal(clientAddress(buildRequest("127.0.0.1", ["10.0.0.1", "203.0.113.1"]), true), "203.0.113.1");
});

test("a proxy that forwards nothing leaves the socket's own address", () => {
    assert.equal(clientAddress(buildRequest("127.0.0.1"), true), "127.0.0.1");
    assert.equal(clientAddress(buildRequest("127.0.0.1", " , "), true), "127.0.0.1");
    assert.equal(clientAddress(undefined, true), "");
});

test("a connection is known by the address it was taken from", () => {
    const server = {"clients": new Map([
        ["taken", new Map([["ipAddress", "203.0.113.1"], ["ws", {"_socket": {"remoteAddress": "127.0.0.1"}}]])],
        ["handed", new Map([["ws", {"_socket": {"remoteAddress": "127.0.0.1"}}]])]
    ])};
    assert.equal(addressOf(server, "taken"), "203.0.113.1");
    assert.equal(addressOf(server, "handed"), "127.0.0.1");
    assert.equal(addressOf(server, "gone"), "");
});

//
// what a budget is counted under
//
test("an IPv4 address is its own key, mapped into IPv6 or not", () => {
    assert.deepEqual(addressKeys("198.51.100.7"), ["198.51.100.7"]);
    assert.deepEqual(addressKeys("::ffff:198.51.100.7"), ["198.51.100.7"]);
    assert.deepEqual(addressKeys("::FFFF:198.51.100.7"), ["198.51.100.7"]);
});

test("an IPv6 address is keyed by its /64 and its /48, however it is written", () => {
    assert.deepEqual(addressKeys("2001:db8:1:2::10"), ["2001:db8:1:2::/64", "2001:db8:1::/48"]);
    assert.deepEqual(addressKeys("2001:0DB8:0001:0002:ffff:0:0:1"), ["2001:db8:1:2::/64", "2001:db8:1::/48"]);
    assert.deepEqual(addressKeys("2001:db8::1"), ["2001:db8:0:0::/64", "2001:db8:0::/48"]);
    assert.deepEqual(addressKeys("fe80::1%eth0"), ["fe80:0:0:0::/64", "fe80:0:0::/48"]);
});

test("what cannot be read as an address is keyed as it came", () => {
    assert.deepEqual(addressKeys(""), [""]);
    assert.deepEqual(addressKeys(undefined), [""]);
    assert.deepEqual(addressKeys("1::2::3"), ["1::2::3"]);
    assert.equal(expandIPv6("1:2:3"), undefined);
});

//
// how many sockets one address holds
//
test("one address holds only so many sockets, and a closed one is given back", () => {
    const server = {"connections": new Map()};
    for (let i = 0; i < CONNECTION_MAX; i++) {
        assert.equal(holdAddress(server, "198.51.100.7"), true);
    }
    assert.equal(holdAddress(server, "198.51.100.7"), false);
    assert.equal(holdAddress(server, "::ffff:198.51.100.7"), false, "the same address mapped into IPv6");
    assert.equal(holdAddress(server, "198.51.100.8"), true, "another address has its own");

    releaseAddress(server, "198.51.100.7");
    assert.equal(holdAddress(server, "198.51.100.7"), true);

    // every socket given back leaves nothing behind
    for (let i = 0; i < CONNECTION_MAX; i++) {
        releaseAddress(server, "198.51.100.7");
    }
    releaseAddress(server, "198.51.100.8");
    assert.equal(server.connections.size, 0);
});

test("an IPv6 subscriber is capped by its /64, and a site by its /48", () => {
    const server = {"connections": new Map()};
    for (let i = 0; i < CONNECTION_MAX; i++) {
        assert.equal(holdAddress(server, "2001:db8:1:2::" + (i + 1).toString(16)), true);
    }
    assert.equal(holdAddress(server, "2001:db8:1:2::ffff"), false, "a new address in the same /64");

    // walking the /64s of one /48 runs into the site's budget
    let held = CONNECTION_MAX;
    for (let subnet = 3; held < CONNECTION_MAX_WIDE; subnet++) {
        for (let i = 0; i < CONNECTION_MAX && held < CONNECTION_MAX_WIDE; i++) {
            assert.equal(holdAddress(server, "2001:db8:1:" + subnet.toString(16) + "::" + (i + 1).toString(16)), true);
            held++;
        }
    }
    assert.equal(holdAddress(server, "2001:db8:1:ff::1"), false);
    assert.equal(holdAddress(server, "2001:db8:2::1"), true, "another site has its own");
});

test("giving back a socket that was never counted changes nothing", () => {
    const server = {"connections": new Map()};
    releaseAddress(server, "198.51.100.7");
    assert.equal(server.connections.size, 0);
});
