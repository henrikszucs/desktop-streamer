# Introduction
Remote Desktop application to reach computers.


## Install and run server
```
cd path/to/server
npm install
node server.js --configuration=path/to/conf.json
```

## Server configuration


```
{
    "port": 8888,               //port of the server
	"https": {
		"key": "server.key",    //private key path (optional)
		"cert": "server.crt",   //private key path (optional)
		"redirectFrom": 8887    //HTTP port that redirect to HTTPS (useful in web), leave empty to open only HTTPS port (optional)
	},
    "db": "database.db",
    "allowSameEmail": true,
    "users": [
        {
            "email": "henyusi@gmail.com",
            "username": "admin",
            "pass": "admin",
            "isAdmin": true
        }
    ]
    
}
```