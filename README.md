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
npm run uninstall -- --bin
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
    "domain": "localhost",                  //access domain for non web clients
    "port": 443,                            //port of the HTTPS server
    "redirect": 80,                         //(optional) HTTP port that redirect to HTTPS (useful in web), delete if want to open only HTTPS port
    "key": "server.key",                    //private key path
    "cert": "server.crt",                   //private cert path
    "ws": 444,                              //websocket port
    "webrtc": {                             //webrtc settings
        "iceServers": [
            "stun:stun.l.google.com:19302"
        ]
    }
}
```

## Folders
```md
.
├── bin - prebuild electron client binaries with ffmpeg
├── conf - configuration files
├── dev/ - developer documents and helper temporary or useful mini scripts
├── src/ - source of the program
│   ├── client/electron - ElectronJS deps (large file and not saved)
│   └── client/web - web UI files
└── tmp - temporary folder for generated files
```

## Binary naming
The bin - binary folder need contains folders or .zip files with the following names:
```md
os can be: win32 | darwin | linux
arch can be:  x64 | ia32 | arm64 | armv7l

<os>-<arch>.zip

or

<os>-<arch>

e.g.

win32-x64.zip
darwin-arm64/
```