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

# Run with custom configuration path
npm run server -- --configuration=./config.json

# Test conf and exit
npm run server -- --configuration=./config.json --compile --exit
```

## Server configuration
server configuration file path: conf/config.json

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
        "remote": {                     //(optional) remote websocket server, it will ignore local ws creation
            "host": "localhost",
            "port": 444
        }
    },
    "ws": {
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
