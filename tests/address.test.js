"use strict";

//
// Import dependencies
//
// internal dependencies
import test from "node:test";
import assert from "node:assert/strict";

// first-party dependencies
import { clientAddress, parseTrustEntry, buildProxyTrust, isTrustedProxy, addressOf, addressKeys, expandIPv6, holdAddress, releaseAddress, PROXY_TRUST_DEFAULT, CONNECTION_MAX, CONNECTION_MAX_WIDE } from "../src/server/ws/address.js";

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
    assert.equal(clientAddress(buildRequest("198.51.100.7"), null), "198.51.100.7");
    assert.equal(clientAddress(buildRequest("198.51.100.7", "203.0.113.1"), null), "198.51.100.7");
});

test("behind a proxy the address is the last one the proxy forwarded", () => {
    const trust = buildProxyTrust();
    assert.equal(clientAddress(buildRequest("127.0.0.1", "203.0.113.1"), trust), "203.0.113.1");

    // what the client wrote into the header itself stands to the left of what
    // the proxy appended, and is never read
    assert.equal(clientAddress(buildRequest("127.0.0.1", "10.0.0.1, 203.0.113.1"), trust), "203.0.113.1");
    assert.equal(clientAddress(buildRequest("127.0.0.1", ["10.0.0.1", "203.0.113.1"]), trust), "203.0.113.1");
});

test("a proxy that forwards nothing leaves the socket's own address", () => {
    const trust = buildProxyTrust();
    assert.equal(clientAddress(buildRequest("127.0.0.1"), trust), "127.0.0.1");
    assert.equal(clientAddress(buildRequest("127.0.0.1", " , "), trust), "127.0.0.1");
    assert.equal(clientAddress(undefined, trust), "");
});

test("a client that reaches the port past the proxy writes nothing it is believed on", () => {
    // the listener is bound to every interface, so the header of a socket that
    // is not the proxy's is the client's own - a fresh budget per try otherwise
    const trust = buildProxyTrust();
    assert.equal(clientAddress(buildRequest("198.51.100.7", "203.0.113.1"), trust), "198.51.100.7");
    assert.equal(clientAddress(buildRequest("::ffff:198.51.100.7", "203.0.113.1"), trust), "::ffff:198.51.100.7");
    assert.equal(clientAddress(buildRequest("2001:db8::7", "203.0.113.1"), trust), "2001:db8::7");
    assert.equal(clientAddress(buildRequest("", "203.0.113.1"), trust), "");
});

test("the proxy is this machine unless its trust names where it is", () => {
    const local = buildProxyTrust();
    assert.deepEqual(PROXY_TRUST_DEFAULT, ["127.0.0.0/8", "::1"]);
    assert.equal(isTrustedProxy(local, "127.0.0.1"), true);
    assert.equal(isTrustedProxy(local, "127.10.0.1"), true);
    assert.equal(isTrustedProxy(local, "::1"), true);
    assert.equal(isTrustedProxy(local, "::ffff:127.0.0.1"), true, "an IPv4 proxy on a dual-stack listener");
    assert.equal(isTrustedProxy(local, "10.0.0.2"), false);

    // a proxy elsewhere is named, as an address or as a range
    const named = buildProxyTrust(["10.0.0.0/8", "2001:db8:1::/48", "192.0.2.5"]);
    assert.equal(isTrustedProxy(named, "10.1.2.3"), true);
    assert.equal(isTrustedProxy(named, "::FFFF:10.1.2.3"), true);
    assert.equal(isTrustedProxy(named, "2001:db8:1:ff::1"), true);
    assert.equal(isTrustedProxy(named, "192.0.2.5"), true);
    assert.equal(isTrustedProxy(named, "192.0.2.6"), false);
    assert.equal(isTrustedProxy(named, "127.0.0.1"), false, "naming a proxy replaces this machine");
    assert.equal(clientAddress(buildRequest("10.1.2.3", "203.0.113.1"), named), "203.0.113.1");
    assert.equal(isTrustedProxy(named, "not an address"), false);
});

test("a trust entry is an address or an address/prefix range", () => {
    assert.deepEqual(parseTrustEntry("10.0.0.0/8"), {"address": "10.0.0.0", "type": "ipv4", "prefix": 8});
    assert.deepEqual(parseTrustEntry("::1"), {"address": "::1", "type": "ipv6", "prefix": undefined});
    assert.deepEqual(parseTrustEntry("fd00::/8"), {"address": "fd00::", "type": "ipv6", "prefix": 8});
    for (const entry of ["localhost", "10.0.0.0/33", "fd00::/129", "10.0.0.0/", "10.0.0.0/8/8", "10.0.0.0/-1", "10.0.0.0/ 8", "", 7]) {
        assert.equal(parseTrustEntry(entry), undefined, String(entry));
    }
    assert.throws(() => buildProxyTrust(["localhost"]), /localhost/);
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
