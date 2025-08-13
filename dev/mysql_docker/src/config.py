import datetime
import time
import os
import subprocess

# set SSH pass
if os.path.isfile("/root/init_run") == False:
    #set SSH pass
    password = ""
    if ("ROOT_PASS" in os.environ) and os.environ["ROOT_PASS"] != "":
        password = os.getenv("ROOT_PASS")
        print("SSH: Set password form enviroment")
    else:
        password = ""
        print("SSH: Password not set")
    if password != "":
        # reset config
        subprocess.run("echo \"root:"+password+"\" | chpasswd", shell=True, check=True)

    #set MySQL pass
    password = ""
    if ("SQL_PASS" in os.environ) and os.environ["SQL_PASS"] != "":
        password = os.getenv("SQL_PASS")
        print("MySQL: Set password form enviroment")
    else:
        password = ""
        print("MySQL: Password not set")
    if password != "":
        # reset config
        subprocess.run("service mariadb start", shell=True, check=True)
        time.sleep(0.5)
        subprocess.run("mysql -uroot -e \"SET PASSWORD FOR 'root'@'localhost' = PASSWORD('" + password + "'); FLUSH PRIVILEGES;\"", shell=True, check=True)
        time.sleep(0.5)
        subprocess.run("service mariadb stop", shell=True, check=True)

    #generate ssl certs
    def generate_cert(keypath, certpath):
        if os.path.isfile(keypath) == False or os.path.isfile(certpath) == False:
            subprocess.run("openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -subj '/C=XX/ST=StateName/L=CityName/O=CompanyName/OU=CompanySectionName/CN=CommonNameOrHostname' -keyout " + keypath + " -out " + certpath + "", shell=True, check=True)
    generate_cert("/etc/ssl/private/apache-html.key", "/etc/ssl/certs/apache-html.crt")
    generate_cert("/etc/ssl/private/apache-phpmyadmin.key", "/etc/ssl/certs/apache-phpmyadmin.crt")

    #write permanent stop
    f = open("/root/init_run", "w")
    f.write(str(datetime.datetime.now()))
    f.close()


