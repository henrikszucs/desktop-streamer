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
| `-c <path>`, `--configuration=<path>` | configuration file (default `./conf/config.json`). Note the two forms: `-c` takes the path as the next argument, `--configuration` only as `--configuration=<path>`. The wrong form (`--configuration <path>`) stops the boot with a message instead of falling back to the default. |
| `--compile` | force a rebuild of `./tmp/web` and `./tmp/desktop`. Without it, a boot that already finds `tmp/web/index.html` skips the build, so web client edits stay invisible. |
| `--exit` | validate the configuration, build, start and stop again without serving |
| `-h`, `--help` | usage |
| `-v`, `--version` | project version |

## Server configuration
Server configuration file path: `conf/config.json` (a working SQLite-backed starting point is in `conf/config.example.json`). The file is checked against the schema in `src/server/config.js` at boot, and a field it does not know is an error, not something ignored.

The block below is annotated, not literal JSON: it carries `//` comments, and it
shows the alternatives of `database` and of `email.auth` as repeated keys — pick
one of each.

```
{
    "http": {                           //the web server that serves the clients
        "domain": "localhost",          //the domain the server listens on
        "port": 443,                    //the HTTPS port
        "key": "server.key",            //private key path, relative to this configuration file
        "cert": "server.crt",           //certificate path, relative to this configuration file
        "appearance": {                 //(optional) how the clients look, every field is optional
            "name": {                   //  the application's name by language code: the browser tab and the
                "en": "My Streamer",    //  desktop window show it in the client's language, the desktop
                "hu": "Saját megosztó"  //  auto-launch entry in English (or the first one given).
            },                          //  Without it: "Desktop Streamer"
            "color": "#006e1c",         //  the default theme colour, a six digit hex RGB (default "#006e1c")
            "theme": "auto"             //  the default theme: "dark", "light", or "auto" to follow the system
        },                              //  (default "auto"). Colour and theme are what a client starts with and
                                        //  what a settings reset goes back to; a user may still change them
        "proxy": {                      //(optional) the address the clients reach this server at, when a proxy
            "domain": "example.com",    //  stands in front of it. The server still listens on "domain"/"port"
            "port": 443,                //  above; this is what is built into the clients and what a redirect
            "redirect": 80              //  points at. "redirect" is the plaintext port of the proxy in front of
        },                              //  "http.redirect" below, refused without one - see "Behind a proxy"
        "redirect": 80,                 //(optional) plaintext HTTP port that redirects to HTTPS
        "cache": {                      //(optional) serve the client files from memory instead of from disk
            "size": 524288000,          //  max cache size in bytes
            "fileSizeLimit": 10485760   //  max size of a file that is cached, bigger ones are read from disk
        },
        "remote": {                     //(optional) point the clients at a websocket server run elsewhere.
            "host": "localhost",        //  Required when this file has no "ws" section, refused beside one
            "port": 444
        }
    },
    "ws": {                             //the realtime server: signaling, pairing, rooms, accounts
        "domain": "localhost",          //the domain the server listens on
        "port": 444,                    //its own port, or the same as "http.port" to share the HTTPS listener
        "key": "server.key",            //private key path, relative to this configuration file - still
        "cert": "server.crt",           //  required when the port is shared, although it is not used then
        "proxy": {                      //(optional) the address the clients open their socket on, when a proxy
            "domain": "example.com",    //  stands in front of this server. Without it the clients are pointed
            "port": 443                 //  at the "http" host and this server's own port
        },
        "database": {                   //a MySQL server...
            "type": "mysql",
            "host": "localhost",
            "port": 3306,
            "user": "root",
            "pass": "root",
            "db": "desktop_streamer"
        },
        "database": {                   //...or a local SQLite file instead
            "type": "sqlite",
            "host": "database.db"       //  path relative to this configuration file
        },                              //Either one is connected at boot and a database that cannot be reached
                                        //  fails it; the tables are created on the first boot
        "webrtc": {
            "iceServers": [             //STUN/TURN servers handed to the clients, at least one
                "stun:stun.l.google.com:19302"
            ]
        },
        "email": {                      //(optional) SMTP sender of the account e-mails, set together with "auth".
            "host": "smtp.example.com", //  It is signed in to at boot, and one that refuses fails the boot
            "port": 587,
            "user": "sender@example.com",
            "auth": {                   //  a password...
                "type": "password",
                "password": "12345678"
            },
            "auth": {                   //  ...or OAuth2
                "type": "OAuth2",
                "clientId": "12345678",
                "clientSecret": "12345678",
                "refreshToken": "12345678"
            }
        },
        "auth": {                       //(optional) sign-in providers, set together with "email" - see
            "google": {                 //  "Google sign-in and email setup". Only "clientId" reaches a client
                "clientId": "1234567890-abc.apps.googleusercontent.com",
                "clientSecret": "GOCSPX-..."
            }
        },
        "permissions": {                //every flag is optional and defaults to the value shown, so {} is enough
            "guestAllowShare": true,    //  a guest may share its screen
            "guestAllowJoin": true,     //  a guest may join a shared screen
            "guestAllowRelay": false,   //  a guest may use the server to relay the media when the two devices
                                        //  cannot reach each other directly
            "userRegister": true,       //  an unknown account may be created at sign-in (false: only accounts
                                        //  already in the database may sign in; irrelevant without "auth")
            "userRegisterRelay": true   //  the relay permission a newly created account gets (stored on the
                                        //  account, change its database row to change it later)
        }
    }
}
```

The rules the block cannot show:

- **At least one section.** `http` needs `domain`, `port`, `key` and `cert`;
  `ws` needs those and `database`, `webrtc` and `permissions`. A file with only
  `http` must carry `http.remote`, and `http.remote` beside a `ws` section is
  refused.
- **Ports.** No two of `http.port`, `http.redirect` and `ws.port` may be the
  same, with one exception: `ws.port` may equal `http.port`, and the socket is
  then served on the HTTPS listener.
- **Paths** — `key`, `cert` and a SQLite `host` — are relative to the directory
  of the configuration file, not to where the server is started.
- **What the clients are built with.** The addresses (`domain`, `port`,
  `proxy`, `remote`) and `http.appearance` are compiled into the clients, so a
  change to them needs `npm run server -- --compile`. Everything under `ws`
  (the ICE servers, the permissions, the sign-in client id) is answered by the
  server at runtime and needs only a restart.
- **Checking a file** without serving it: `npm run server -- -c <path> --exit`.

### Behind a proxy

`http.proxy` and `ws.proxy` are for a server that is not reached where it
listens — a reverse proxy, a tunnel, a port forward. `domain` and `port` stay
what the server binds to (`localhost:8443`), and the `proxy` pair is what the
person's browser types (`botto.hu:443`): it is the address compiled into the
clients (`index.json`), the one the HTTPS redirect sends a plaintext request
to, and the one the account mail names the server by. The boot prints both, the
proxy address as `Available` and the socket as `Listening`.

`http.proxy.redirect` is the same thing for the plaintext side: `http.redirect`
stays the port the redirect server binds to, and `proxy.redirect` is the port
the proxy answers on in front of it. It only names that address — the redirect
itself already answers with the public HTTPS one — so it is refused without an
`http.redirect` to stand in front of, and left out the boot reports the bound
port as before rather than guessing a public one. The `ws` proxy takes no
`redirect`; there is nothing to redirect on a socket.

A `ws` section without a `proxy` of its own is still pointed at the `http`
host, as before — and at the whole `http` address when the two share a port,
since that is one listener behind the proxy. Give `ws.proxy` its own value
whenever the proxy reaches the two servers at different addresses.

```json
"http": {
    "domain": "localhost",
    "port": 8443,
    "redirect": 8080,
    "proxy": {"domain": "botto.hu", "port": 443, "redirect": 80}
}
```

```
Starting HTTP server...
    Available: https://botto.hu
    Listening: https://localhost:8443
    Redirect: http://botto.hu
    Listening: http://localhost:8080
```

> [!NOTE]
> The clients carry these addresses from the compile, not from the boot, so
> changing a `proxy` needs `npm run server -- --compile`.

## Google sign-in and email setup

Sign-in is optional. Without the `ws.auth` and `ws.email` sections every client
is a guest and the login screen shows no provider. The two sections are only
valid **together**: sign-in sends emails, so the server refuses a configuration
that carries one without the other. The Google button appears on the login
screen as soon as the server answers a `clientId`; the browser loads Google's
own sign-in script for it, so the address the client is opened on has to be
known to Google as an origin.

### 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with the Google account
   that will own the credentials.
2. Project picker (top bar) → **New project** → give it a name (e.g.
   `desktop-streamer`) → **Create**, and select it.

### 2. Configure the consent screen

1. Left menu → **APIs & Services** → **OAuth consent screen** (on newer
   consoles this is **Google Auth Platform** → **Branding** / **Audience**).
2. **User type**: `External` (`Internal` only if every user is in your own
   Google Workspace organisation).
3. Fill the required fields: app name, user support email, developer contact
   email. Everything else can stay empty.
4. **Audience / Test users**: while the app is in *Testing* only the accounts
   listed here can sign in. Add your own address now; publish the app
   (**Publish app**) once you want anybody with a Google account to sign in.

### 3. Create the OAuth client (this is `ws.auth.google`)

1. **APIs & Services** → **Credentials** → **Create credentials** →
   **OAuth client ID**.
2. **Application type**: `Web application`.
3. **Authorized JavaScript origins** → **Add URI**: the exact origin the web
   client is opened on, scheme, domain and port, **no path and no trailing
   slash**. Add one line per address you serve, for example:

   ```
   https://localhost:8443
   https://desktop.example.com
   ```

   This is `https://` + `http.domain` + `:` + `http.port` from your
   configuration (leave the port off when it is `443`), or `http.proxy` instead
   when one is configured — the origin is the address the browser is opened on.
   Google does not accept a bare IP address here, so use a host name.
4. **Authorized redirect URIs**: not needed for the sign-in button itself.
   Add `https://developers.google.com/oauthplayground` only if you will follow
   step 5 (Gmail OAuth2 for the sender) with this same client.
5. **Create**, then copy the **Client ID** (ends in
   `.apps.googleusercontent.com`) and the **Client secret** into the
   configuration:

   ```json
   "auth": {
       "google": {
           "clientId": "1234567890-abc.apps.googleusercontent.com",
           "clientSecret": "GOCSPX-..."
       }
   }
   ```

   The secret never reaches a client; only the id does.

### 4. Add the sending email address (this is `ws.email`)

Any SMTP server works. Set `host`, `port` and `user` (the address the mails
are sent from) and pick **one** of the two `auth` forms:

**Password** — the simplest. For a Gmail / Google Workspace sender:

1. Turn on 2-Step Verification for the account:
   <https://myaccount.google.com/security>.
2. Create an app password: <https://myaccount.google.com/apppasswords> →
   name it (e.g. `desktop-streamer`) → **Create** → copy the 16 characters
   (spaces do not matter).
3. Configure:

   ```json
   "email": {
       "host": "smtp.gmail.com",
       "port": 465,
       "user": "sender@gmail.com",
       "auth": {
           "type": "password",
           "password": "abcdefghijklmnop"
       }
   }
   ```

**OAuth2** — no password stored; needs a refresh token for the sender account,
see step 5.

### 5. (Optional) Gmail OAuth2 refresh token for the sender

1. In the OAuth client of step 3 make sure
   `https://developers.google.com/oauthplayground` is listed under
   **Authorized redirect URIs**.
2. Open <https://developers.google.com/oauthplayground/>, click the gear
   (top right) → tick **Use your own OAuth credentials** → paste the client id
   and secret → **Close**.
3. In the left list, step 1: type the scope `https://mail.google.com/` into
   the input box → **Authorize APIs** → sign in with the **sender** account
   (it must be a test user while the app is in Testing) → allow.
4. Step 2: **Exchange authorization code for tokens** → copy the
   **Refresh token**.
5. Configure:

   ```json
   "email": {
       "host": "smtp.gmail.com",
       "port": 465,
       "user": "sender@gmail.com",
       "auth": {
           "type": "OAuth2",
           "clientId": "1234567890-abc.apps.googleusercontent.com",
           "clientSecret": "GOCSPX-...",
           "refreshToken": "1//0g..."
       }
   }
   ```

> [!WARNING]
> While the consent screen is in *Testing*, Google expires refresh tokens
> after 7 days; publish the app or the sender stops working a week later. The
> Gmail scope is a restricted one, so a published-but-unverified app shows an
> "unverified app" warning and is capped by Google at a small number of users.
> If that is a problem, use the app-password form of step 4 instead.

### 6. Restart and check

1. Validate the configuration: `npm run server -- --exit` — the boot fails on a
   malformed `email`/`auth` section or on one present without the other.
2. Start the server. The client id is answered at runtime, so **no
   `--compile`** is needed for it; a rebuild is only needed when an address
   (`domain`, `port`, `proxy`, `remote`) or `http.appearance` changed.
3. Open the web client on one of the origins of step 3 → **Login**: the
   "Sign in with Google" button is there. If it is missing, the server did not
   answer a `clientId`; if Google shows *Error 400: origin_mismatch*, the
   address in the browser is not listed under Authorized JavaScript origins
   exactly (scheme, host and port).
4. `permissions.userRegister` decides whether an unknown Google account may
   create itself at sign-in (`true`) or only already stored accounts may sign
   in (`false`).

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
