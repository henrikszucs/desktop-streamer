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
    "port": 443,               //port of the server
    "https": {
        "key": "server.key",    //private key path (optional)
        "cert": "server.crt",   //private key path (optional)
        "redirectFrom": 80    //HTTP port that redirect to HTTPS (useful in web), delete if want to open only HTTPS port (optional)
    },
    "db": {         // mysql database connection
        "host": "localhost",
        "port": 3306,
        "user": "user",
        "pass": "password",
        "database": "desktop_streamer"
    },
    "email": {                 //email connection to send email this enable password recovery and registration (optional) 
        "smtp": {
            "host": "smtp.outlook.com",
            "port": 465,
            "user": "user@email.com",
            "pass": "Password123",
            "from": "user@email.com",
            "name": "Administrator"
        },
        "allowRegister": true     //allow users to register (default is true)
    },
    "allowSameEmail": true,      // allow that multiple user from same email
    "allowGuest": true,          // allow to create room without register
    "users": [                   // userlist (only create users if user table not exist in database)
        {
            "email": "henyusi@gmail.com",
            "username": "admin",
            "pass": "admin",
            "isAdmin": true         // this user can add modify and delete users
        }
    ]
    
}
```