# Introduction
Remote Desktop application to reach computers.


## Install and run server
```
cd path/to/server
npm install
node server.js --configuration=path/to/conf.json
```

## Server configuration
server configuration file path: server/conf/conf.json

```
{
    "port": 443,                //port of the server
    "wsport": 444,              //websocket port
    "https": {
        "key": "server.key",    //private key path (optional)
        "cert": "server.crt",   //private key path (optional)
        "redirectFrom": 80      //HTTP port that redirect to HTTPS (useful in web), delete if want to open only HTTPS port (optional)
    }
}
```

## Client
clients files in client/desktop/resources/app

clients configuration file path: client/desktop/resources/app/ui/conf.js

Share client/desktop/resources folder with platform executable files (current win32 is default)