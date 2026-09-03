# Introduction
Remote Desktop application to reach computers.

## Supported platforms
Currently the following client platforms are supported:

| Platform      | Access | Control |
| ------------- | :----: | :-----: |
| Web (browser) |   ✅   |   ❌    |
| Windows (x64) |   ✅   |   ✅    |
| MacOS         |   ❌   |   ❌    |
| Linux         |   ❌   |   ❌    |

- **Access**: share and view a desktop (screen capture and streaming).
- **Control**: remote keyboard and mouse input, needs the native client.

## Server usage

> [!CAUTION]
> Always replace the default certificate and password. The default settings only for testing purposes.

```bash
# Install and run
npm install
npm run server

# Force compile
npm run server -- --compile

# Uninstall
npm run uninstall

# Uninstall with bin folder
npm run uninstall -- --bin

# Run with custom configuration path (inline "=" form, or "-c <path>")
npm run server -- --configuration=./config.json
npm run server -- -c ./config.json

# Test conf and exit
npm run server -- --configuration=./config.json --compile --exit

# Flags and version
npm run server -- --help
npm run server -- --version
npm run uninstall -- --help
```

Server flags:

| Flag | Meaning |
| ---- | ------- |
| `-c <path>`, `--configuration=<path>` | configuration file (default `./conf/config.json`). Note the two forms: `-c` takes the path as the next argument, `--configuration` only as `--configuration=<path>`. `--configuration <path>` is **not** parsed and falls back to the default. |
| `--compile` | force a rebuild of `./tmp/web` and `./tmp/desktop`. Without it, a boot that already finds `tmp/web/index.html` skips the build, so web client edits stay invisible. |
| `--exit` | validate the configuration, build, start and stop again without serving |
| `-h`, `--help` | usage |
| `-v`, `--version` | project version |

## Server configuration
server configuration file path: `conf/config.json` (a working SQLite-backed starting point is in `conf/config.example.json`).

The block below is annotated, not literal JSON: it carries `//` comments, and it
shows the alternatives of `database` and of `email.auth` as repeated keys — pick
one of each. At least one of `http` and `ws` must be present, and the two
servers may share a port only when it is `http.port`.

```
{
    "http": {
        "name": {                       // (optional) cutomized name of the application
            "en": "My Desktop streamer",
            "hu": "Saját távoli megosztó"
        },
        "domain": "localhost",          //access domain
        "port": 443,                    //port of the server
        "key": "server.key",            //private key path
        "cert": "server.crt",           //private cert path
        "redirect": 80,                 //(optional) HTTP port that redirect to HTTPS (useful in web), delete if want to open only HTTPS port
        "cache": {                      //(optional) cache HTTP server data into memory (delete to load directly from disk)
            "size": 524288000,          //max cache size in bytes
            "fileSizeLimit": 10485760   //max file size that can cached (ignore too big files)
        },
        "remote": {                     //(optional) point the clients at a websocket server run elsewhere.
            "host": "localhost",        //  Mutually exclusive with the "ws" section below: a configuration
            "port": 444                 //  carrying both is rejected, it is not silently ignored.
        }
    },
    "ws": {                             //the realtime/signaling server. It is currently cut back to the
                                        //  connection itself, so "database", "email" and the secret half of
                                        //  "auth" are validated but not read yet; only auth.<provider>.clientId
                                        //  reaches a client. They are still required/accepted so a configuration
                                        //  written today keeps working when the persistence lands.
        "domain": "localhost",          //access domain
        "port": 444,
        "key": "server.key",            //private key path
        "cert": "server.crt",           //private cert path
        "database": {                   //MySQL server connection
            "type": "mysql",
            "host": "localhost",
            "port": 3306,
            "user": "root",
            "pass": "root",
            "db": "desktop_streamer"
        },
        "database": {                   //or a local SQLite file instead of a server
            "type": "sqlite",
            "file": "database.sqlite"   //path relative to this configuration file, it is created on the first boot
        },
        "webrtc": {
            "iceServers": [
                "stun:stun.l.google.com:19302"
            ]
        },
        "email": {                      //(optional) email sending connections with smtp, must be set together with "auth"
            "host": "mail.example.com",
            "port": 567,
            "user": "user@example.com",
            "auth": {
                "type": "password",
                "password": "12345678"
            },
            "auth": {
                "type": "OAuth2",
                "clientId": "12345678",
                "clientSecret": "12345678",
                "refreshToken": "12345678"
            }
        },
        "auth": {                       //(optional) Google auth keys, must be set together with "email" (sign-in sends emails)
            "google": {
                "clientId": "1234567890",
                "clientSecret": "12345678"
            }
        },
        "permissions": {                // permission settings
            "guestAllowShare": true,    // Allow guest user to share screen
            "guestAllowJoin": true,     // Allow guest user to join to a screen
            "guestAllowRelay": false,   // Guest user allow to use server for media data transfer
            "userRegister": true,       // Allow a new user to be registered at sign-in (false: only the already stored accounts may sign in, irrelevant without "auth")
            "userRegisterRelay": true   // Newly registered users get relay permission as allow or deny (this stores for later usage, for modification need DB table update)
        }
    } 
}
```

## Folders
```md
.
├── .claude/ Claude Code setting and configurations
├── conf/ - configuration files
├── dev/ - developer documents and helper temporary or useful mini scripts
├── model/ - The CNN model development folder
├── tests/ - node --test suites (npm test)
├── src/ - source of the program
│   ├── client/ - Client program's code
│   │   ├── electron/ - ElectronJS specific codes
│   │   ├── native/ - Platform native dependencies
│   │   └── web/ - Common web dependencies
│   └── server/ - Server program's code
│   
├── bin/ - prebuild electron client binaries with ffmpeg (used in runtime)
└── tmp/ - temporary folder for generated files (used in runtime)
```


## AI assisted development
The project contain project specific skills and description for Claude Code.
The following MCP and skills used:
- https://github.com/mattpocock/skills
- https://github.com/DeusData/codebase-memory-mcp
- https://playwright.dev/docs/getting-started-mcp

## License
Desktop Streamer is free software: you can redistribute it and/or modify it
under the terms of the **GNU Affero General Public License, version 3 or later
(AGPL-3.0-or-later)**. See [`LICENSE`](LICENSE) for the full text. Because the
server is delivered over a network, the AGPL section 13 obligation applies:
operators of a modified server must offer its complete corresponding source to
their users.

### Bundled libraries
The realtime protocol and MIME helpers are vendored directly into this
repository instead of being pulled from npm:

| Path | Upstream | License in this repo |
| ---- | -------- | -------------------- |
| `src/server/communicator.js` | [`easy-communicator`](https://github.com/henrikszucs/easy-communicator) | LGPL-3.0-or-later |
| `src/server/mime.js` | [`easy-mime`](https://github.com/henrikszucs/easy-mime) | LGPL-3.0-or-later |
| `src/client/web/libs/communicator/communicator.js` | [`easy-communicator`](https://github.com/henrikszucs/easy-communicator) | LGPL-3.0-or-later |

These libraries are authored and copyright-held by Henrik Szűcs. Their upstream
npm packages are (were) published under GPL-2.0; the copies bundled here are
re-licensed by the copyright holder under the **GNU Lesser General Public
License, version 3 or later**, which is compatible with the project's AGPL-3.0
license, and are no longer listed as npm dependencies. Each vendored file carries
an SPDX header, and both `src/server/` and `src/client/web/libs/communicator/`
contain their own `COPYING` (GPL-3.0) and `COPYING.LESSER` (LGPL-3.0) texts. The
MIME table in `mime.js` follows the schema of jshttp/mime-db (MIT).

### Contributing
Contributions require signing the [Contributor License Agreement](CLA.md) once,
by a statement on your first pull request. The CLA lets the maintainer keep the
project under AGPL-3.0, keep the bundled libraries under LGPL-3.0, and offer
separate commercial licenses.
