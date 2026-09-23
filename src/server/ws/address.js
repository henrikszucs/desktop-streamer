"use strict";

// who a socket is on the network: the address a person is shown when somebody
// asks to connect, the one the sessions window lists, and the one failed tries
// and open sockets are counted against. Behind a proxy the socket is the proxy's, so the address
// is the one the proxy says it forwarded - read once, when the socket is taken.

// The client's address from the upgrade request. A proxy appends the address it
// took the connection from to X-Forwarded-For, so the last entry is the one our
// own proxy wrote; anything to the left of it is whatever the client claimed and
// is never read. Without a proxy the header is the client's own text and is
// ignored altogether.
const clientAddress = function(req, isProxied) {
    const socketAddress = req?.socket?.remoteAddress ?? "";
    if (isProxied !== true) {
        return socketAddress;
    }
    const header = req?.headers?.["x-forwarded-for"];
    const text = (Array.isArray(header) === true ? header.join(",") : header);
    if (typeof text !== "string") {
        return socketAddress;
    }
    const forwarded = text.split(",").map(function(entry) {
        return entry.trim();
    }).filter(function(entry) {
        return entry !== "";
    });
    return forwarded[forwarded.length - 1] ?? socketAddress;
};

// the address a connection was taken from, as clientConnect in ws.js wrote it,
// or the socket's own for a client that was not taken through there
const addressOf = function(server, sessionId) {
    const client = server.clients.get(sessionId);
    return client?.get("ipAddress") ?? client?.get("ws")?._socket?.remoteAddress ?? "";
};

// the eight groups of an IPv6 address, the "::" run spelled out
const expandIPv6 = function(address) {
    const halves = address.split("::");
    if (halves.length > 2) {
        return undefined;
    }
    const head = (halves[0] === "" ? [] : halves[0].split(":"));
    const tail = (halves.length === 1 || halves[1] === "" ? [] : halves[1].split(":"));
    const missing = 8 - head.length - tail.length;
    if (missing < 0 || (halves.length === 1 && missing !== 0)) {
        return undefined;
    }
    return [...head, ...new Array(missing).fill("0"), ...tail];
};

const prefixOf = function(groups, count) {
    return groups.slice(0, count).map(function(group) {
        return (parseInt(group, 16) || 0).toString(16);
    }).join(":") + "::/" + (count * 16);
};

// What a budget of tries is counted under, narrowest first. An IPv4 address is
// one subscriber. An IPv6 subscriber is handed a whole /64 and can walk through
// it, so the prefix is the key - and the /48 above it as well, the most a site
// is usually given, since keying on the /64 alone would hand anybody who holds
// a /48 sixty-five thousand budgets. An IPv4 address mapped into IPv6 is the
// IPv4 address.
const addressKeys = function(address) {
    let text = String(address ?? "").trim().toLowerCase();
    const zone = text.indexOf("%");
    if (zone !== -1) {
        text = text.slice(0, zone);
    }
    if (text.startsWith("::ffff:") === true && text.includes(".") === true) {
        return [text.slice(7)];
    }
    if (text.includes(":") === false) {
        return [text];
    }
    const groups = expandIPv6(text);
    if (groups === undefined) {
        return [text];
    }
    return [prefixOf(groups, 4), prefixOf(groups, 3)];
};

// How many sockets one address may hold open at once. Every socket is a
// communicator and a slice of memory, so without a cap one address could
// open as many as it likes and hold what each may hold. A person has a
// window or a few; a house or an office behind one address has a few dozen.
// The /48 of an IPv6 address is a site, and gets the budget of one.
const CONNECTION_MAX = 32;
const CONNECTION_MAX_WIDE = 256;

const connectionMaxOf = function(key) {
    return key.endsWith("/48") === true ? CONNECTION_MAX_WIDE : CONNECTION_MAX;
};

// a socket from this address is taken, counted against every key of it - or
// refused, with nothing counted, when any of them is full
const holdAddress = function(server, address) {
    const keys = addressKeys(address);
    const isFull = keys.some(function(key) {
        return (server.connections.get(key) ?? 0) >= connectionMaxOf(key);
    });
    if (isFull === true) {
        return false;
    }
    for (const key of keys) {
        server.connections.set(key, (server.connections.get(key) ?? 0) + 1);
    }
    return true;
};

// and given back when that socket closes; a socket that was never counted
// (handed to clientConnect directly) gives back nothing
const releaseAddress = function(server, address) {
    for (const key of addressKeys(address)) {
        const count = server.connections.get(key);
        if (count === undefined) {
            continue;
        }
        if (count <= 1) {
            server.connections.delete(key);
        } else {
            server.connections.set(key, count - 1);
        }
    }
};

export { clientAddress, addressOf, addressKeys, expandIPv6, holdAddress, releaseAddress, CONNECTION_MAX, CONNECTION_MAX_WIDE };
export default { clientAddress, addressOf, addressKeys, expandIPv6, holdAddress, releaseAddress, CONNECTION_MAX, CONNECTION_MAX_WIDE };
