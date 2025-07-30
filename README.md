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
        "domain": "localhost",      //access domain for non web clients
        "port": 443,                //port of the server
        "key": "server.key",		//private key path
        "cert": "server.crt",		//private cert path
        "redirect": 80,				//(optional) HTTP port that redirect to HTTPS (useful in web), delete if want to open only HTTPS port
        "cache": {                  //(optional) cache HTTP server data into memory (delete to load directly from disk)
            "size": 524288000, 		//max cache size in bytes
            "sizeLimit": 10485760   //max file size that can cached (ignore too big files)
        },
        "downloadOnly": false,      //web ui show only download options
        "remote": {                 //(optional) remote websocket server, it will ignore local ws creation
            "host": "localhost",
            "port": 444
        }	
    },
    "ws": {
        "port": 444,
        "key": "server.key",		//private key path
        "cert": "server.crt",		//private cert path
        "sql": {                    //MySQL server connection
            "host": "localhost",
            "port": 3306,
            "user": "root",
            "pass": "root"
        }
        "features": {               //backend features
            "guestLogin": false,
            "register": true
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