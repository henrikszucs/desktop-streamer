# Introduction
Remote Desktop application to reach computers.


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
npm run server -- --configuration=./conf.json

# Test conf and exit
npm run server -- --configuration=./conf.json --compile --exit
```

## Server configuration
server configuration file path: server/conf/conf.json

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
        "webrtc": {
            "iceServers": [
                "stun:stun.l.google.com:19302"
            ]
        },
        "email": {                      //email sending connections with smtp
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
        "auth": {                       // Google auth keys
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
