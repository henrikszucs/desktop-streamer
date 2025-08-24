#!/bin/bash
python3 /root/config.py

service ssh start
service mariadb start
a2ensite phpmyadmin
service apache2 start
/bin/bash