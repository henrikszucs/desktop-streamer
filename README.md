# Introduction
Remote Desktop application to reach computers.


## Install and run server
### Basic run
```
cd path/to/server
npm install
npm run server
```

### Custom configuration
```
cd path/to/server
npm install
npm run compile
npm run server -- --configuration=./conf.json
npm run clean
```


## Server configuration
server configuration file path: server/conf/conf.json

```
{
    "http": {
        "port": 443,                //port of the server
        "key": "server.key",		//private key path
        "cert": "server.crt",		//private cert path
        "redirect": 80,				//(optional) HTTP port that redirect to HTTPS (useful in web), delete if want to open only HTTPS port
        "cache": {
            "size": 524288000, 		//max cache size in bytes
            "expire": 120000 		//miliseconds to expire
        }

        "remote": "localhost:444"	//(optional) remote websocket server, it will ignore local ws creation
    },
    "ws": {
        "port": 444,
        "key": "server.key",		//private key path
        "cert": "server.crt",		//private cert path
        "sql": {
            "host": "localhost",
            "port": 3306,
            "user": "",
            "pass": ""
        }
        "login": {
            "allowGuests": true
        }
    } 
}
```

## Folders
./dev - developer documents
./src - source of the program
./conf - configuration files
./tmp - temporary folder for generated files
