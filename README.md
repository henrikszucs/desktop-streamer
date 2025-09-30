# Introduction
Remote Desktop application to reach computers.


## Server usage

> [!CAUTION]
> Always replace the default certificate and password. The default settings only for testing purposes.

### Basic run
```
npm install
npm run server
```

### Uninstall
```
npm run uninstall
```

### Custom configuration
```
npm run server -- --configuration=./conf.json
```

### Force compile
```
npm run server -- --compile
```

### Exit after start
```
npm run server -- --exit
```

### Example to compile custom conf
```
npm run server -- --configuration=./conf.json --compile --exit
```


## Server configuration
server configuration file path: server/conf/conf.json

```
{
    "http": {
        "domain": "localhost",          //access domain for non web clients
        "port": 443,                    //port of the server
        "key": "server.key",            //private key path
        "cert": "server.crt",           //private cert path
        "redirect": 80,                 //(optional) HTTP port that redirect to HTTPS (useful in web), delete if want to open only HTTPS port
        "cache": {                      //(optional) cache HTTP server data into memory (delete to load directly from disk)
            "size": 524288000,          //max cache size in bytes
            "sizeLimit": 10485760       //max file size that can cached (ignore too big files)
        },
        "remote": {                     //(optional) remote websocket server, it will ignore local ws creation
            "host": "localhost",
            "port": 444
        }
    },
    "ws": {
        "port": 444,
        "key": "server.key",                //private key path
        "cert": "server.crt",               //private cert path
        "database": {                       //MySQL server connection
            "type": "mysql",
            "host": "localhost",
            "port": 3306,
            "user": "root",
            "pass": "root",
            "db": "desktop_streamer"
        },
        "emails": [                           //email sending connections with smtp
            {
                "host": "",
                "port": 567,
                "user": "",
                "limit": 720,
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
            }
        ],
        "webrtc": {
            "iceServers": [
                "stun:stun.l.google.com:19302"
            ]
        },
        "features": {
            "screenSharing": {                  // (optional) Screen sharing options (delete to remove screen share feature)
                "guestAllowShare": true,
                "guestAllowJoin": true
            },
            "serviceSharing": {                 // (optional) Service sharing option (delete to remove service share feature)
                "title": "Games",
                "titleIcon": "sports_esports"
            },
            "auth": {                           // how can autenticate into the app
                "local": {
                    "allowPasswordLogin": true,
                    "allowCodeLogin": true,
                    "allowRegister": true
                },
                "google": {
                    "clientId": "1234567890",
                    "clientSecret": "12345678"
                }
            }
        }
    } 
}
```

## Folders
```md
.
├── dev/ - developer documents and helper temporary or useful mini scripts
├── src/ - source of the program
│   ├── client/electron - ElectronJS deps (large file and not saved)
│   └── client/web - web UI files
├── conf - configuration files
└── tmp - temporary folder for generated files
```