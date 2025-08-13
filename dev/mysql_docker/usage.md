## Ports
PHP server 80, 443 (Secure)
MySQL 3306
SSH 22
PhpMyAdmin 8888, 8889 (Secure)
Node server

## Preconfiguration

Apache ssl:     ./src/apache/ssl.crt
                ./src/apache/ssl.key

phpMyAdmin ssl: ./src/phpmyadmin/ssl.crt
                ./src/phpmyadmin/ssl.key

Apache folder:  ./src/project-apache/
                /var/www/html/

nodejs folder:  ./src/project-node/
                /root/nodejs/

## Build
docker build -t my-web ./

## Run container
docker run -p 8888:22 -p 8889:80 -p 8890:443 -p 8891:3306 -p 8892:8888 -p 8893:8889 -t -i --env ROOT_PASS=12345678 --env SQL_PASS=12345678 my-web

docker run -p 22:22 -p 80:80 -p 443:443 -p 3306:3306 -p 8888:8888 -p 8889:8889 -t -i --env ROOT_PASS=12345678 --env SQL_PASS=12345678 my-web

docker run -p 8888:22 -p 8889:80 -p 8890:443 -p 8891:3306 -p 8892:8888 -p 8893:8889 -t -i --env ROOT_PASS=12345678 --env SQL_PASS=12345678 --mount source=myvol,target=/project/ my-web

## Stop container
docker stop <ccfac1f88d1b>

## Start container
docker start <ccfac1f88d1b>

## Inside actions

### run ssh
service ssh start
service ssh stop

### run mysql
service mariadb start
service mariadb stop
mysql

### run apache/phpmyadmin
service apache2 start
service apache2 stop
a2ensite html
a2dissite html
a2ensite phpmyadmin
a2dissite phpmyadmin

### Change password
echo "root:12345678" | chpasswd   //set password

### Other
useradd -m -s /bin/bash henrik      //add user
echo "henrik:12345678" | chpasswd   //set password
usermod -a -G henrik root           //add to group

chmod -R g+rwx DirectoryName

chown -R www-data:www-data /var/www/html

tmux
tmux ls
tmux kill-session -t <session-id>
tmux attach -t <session-id>
CTRL + B && D