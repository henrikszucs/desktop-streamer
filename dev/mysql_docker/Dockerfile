# set operating system
FROM debian:12
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8
RUN mkdir -p /root/
WORKDIR /root/

#install essencial packages
RUN apt update
RUN apt upgrade -y
RUN apt install -y build-essential wget curl unzip
#zlib1g-dev libncurses5-dev libgdbm-dev libnss3-dev libssl-dev libreadline-dev libffi-dev libsqlite3-dev libbz2-dev 

#install ssh
RUN apt install -y openssh-server tmux
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
RUN sed -i 's/PermitRootLogin without-password/PermitRootLogin yes/' /etc/ssh/sshd_config

#install Apache
RUN apt install -y apache2
RUN a2enmod ssl rewrite

#install MySQL
RUN apt install -y mariadb-server
COPY ./src/mysql/my.cnf /etc/mysql/my.cnf
RUN mkdir -p /var/run/mysqld
RUN chmod 777 -R /var/run/mysqld
RUN mkdir -p /var/lib/mysql
RUN chmod 777 -R /var/lib/mysql
RUN mkdir -p /var/log/mysql
RUN chmod 777 -R /var/log/mysql

#install PHP
RUN apt install -y php libapache2-mod-php php-mysql

#install nodejs
RUN curl -fsSL https://deb.nodesource.com/setup_20.x -o nodesource_setup.sh
RUN bash nodesource_setup.sh
RUN apt install -y nodejs
RUN rm nodesource_setup.sh

#install python
RUN apt install -y python3
RUN apt install -y python3-pip
RUN python3 -m pip config set global.break-system-packages true


#copy phpMyAdmin
RUN mkdir -p /var/www/phpmyadmin
COPY ./src/phpmyadmin/phpMyAdmin.zip /var/www/phpmyadmin
RUN cd /var/www/phpmyadmin && unzip phpMyAdmin.zip -d ./ && mv phpMyAdmin-5.2.1-all-languages/* ./ && rm -fr phpMyAdmin-5.2.1-all-languages && rm -fr phpMyAdmin.zip

#copy personal files
RUN mkdir -p /var/www/html
RUN cd /var/www/html && rm *
RUN cd /var/www/ && chown -R www-data:www-data ./html
COPY ./src/project-apache/ /var/www/html/
RUN mkdir -p /root/nodejs
COPY ./src/project-node/ /root/nodejs/

#copy certs
COPY ./src/apache/ssl.crt /etc/ssl/certs/apache-html.crt
COPY ./src/apache/ssl.key /etc/ssl/private/apache-html.key
COPY ./src/phpmyadmin/ssl.crt /etc/ssl/certs/apache-phpmyadmin.crt
COPY ./src/phpmyadmin/ssl.key /etc/ssl/private/apache-phpmyadmin.key

#setup apache servers
RUN cd /etc/apache2/sites-enabled && rm *
COPY ./src/apache/ /etc/apache2

#clean and run
RUN apt autoremove -y
COPY ./src/start.sh /root
COPY ./src/config.py /root
CMD [ "/root/start.sh" ]