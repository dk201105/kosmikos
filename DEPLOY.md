# Deploying Kosmikos securely

Steps for the server that runs the site. Each step says how to check it worked.
`npm test` runs an end-to-end check against a running server
(`BASE_URL=https://your-domain npm test`); it creates and deletes a throwaway account.

## Deployment order

The numbered steps below are ordered by importance. To set up a server, do
them in this order. Assumes Ubuntu 22.04/24.04, a domain whose DNS A record
points at the server, and `sudo` access. Replace `YOUR-DOMAIN` throughout.

1. **Firewall**, so only SSH and the web are reachable:
   ```bash
   sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
   ```
2. **Software.** The app needs Node 20.12+; Ubuntu's own `nodejs` package is too
   old, so use NodeSource:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs mariadb-server nginx certbot git
   node -v   # must be v20.12 or newer
   ```
3. **Database.**
   - New site: `sudo mysql < schema.sql`
   - Moving an existing site: on the old machine `mysqldump -u root -p kosmikos > kosmikos.sql`,
     copy it over, then
     ```bash
     sudo mysql -e "CREATE DATABASE kosmikos" && sudo mysql kosmikos < kosmikos.sql
     sudo mysql kosmikos -e "ALTER TABLE users MODIFY password VARCHAR(255) NOT NULL"
     sed -n '/CREATE TABLE IF NOT EXISTS sessions/,/);/p' schema.sql | sudo mysql kosmikos
     ```
4. **Database accounts**: step 1 below.
5. **Code, app user, permissions, `.env`**: step 7, parts 1 and 2. In `.env` set
   `DB_USER=kosmikos_app`, its password, and a `SESSION_SECRET` (leave `NODE_ENV`
   out: the service sets it). Copy existing uploads into `/srv/kosmikos/uploads/`.
6. **HTTPS**: step 2, parts 1-4.
7. **Start the app**: step 7, part 3.
8. **Existing users**: step 4 (hash leftover plain-text passwords), run from `/srv/kosmikos`.
9. **MySQL settings** (step 6) and **backups** (step 3).
10. **Check everything**: `BASE_URL=https://YOUR-DOMAIN npm test`, then log in with a browser.

### Updating to a new version later

```bash
cd ~/kosmikos && git pull                         # your clone of the repo
git archive main | sudo tar -x -C /srv/kosmikos   # .env and uploads/ are not in git, so they're kept
cd /srv/kosmikos && sudo npm ci --omit=dev
sudo chown -R root:kosmikos /srv/kosmikos && sudo chown -R kosmikos:kosmikos /srv/kosmikos/uploads
sudo find /srv/kosmikos -path /srv/kosmikos/uploads -prune -o -type f -exec chmod 640 {} +
sudo systemctl restart kosmikos
BASE_URL=https://YOUR-DOMAIN npm test
```

## 1. Change the leaked database password and stop using root

The old root password is in this repository's git history, so treat it as public.

1. Make three new random passwords:
   ```bash
   node -e "for (let i=0;i<3;i++) console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
2. Copy `deploy/db-users.sql` somewhere outside the repo, replace the three
   `CHANGE_ME_*` values, run it, then delete the copy:
   ```bash
   sudo mysql < /tmp/db-users.sql && shred -u /tmp/db-users.sql
   ```
   (Use `mysql -u root -p < /tmp/db-users.sql` if root logs in with a password.)
3. In `.env`, set `DB_USER=kosmikos_app` and `DB_PASSWORD=` the app password.
4. Restart the app.

**Check:**
- `mysql -u root -p` with the **old** password is rejected.
- `npm test` passes (the app works on the restricted account).
- `mysql -u kosmikos_app -p kosmikos -e "DROP TABLE comments"` is **denied**.

## 2. HTTPS with nginx

The app itself only speaks HTTP and now listens on `127.0.0.1` only, so nginx
in front of it handles HTTPS. Config: `deploy/nginx-kosmikos.conf`.

Your domain's DNS must already point at the server, and ports 80 and 443 must be open.

1. Install nginx and certbot: `sudo apt install nginx certbot`
2. **First the HTTP part only** (the full config refers to a certificate that doesn't exist yet):
   ```bash
   sudo mkdir -p /var/www/certbot
   sed -n '1,/^}/p' deploy/nginx-kosmikos.conf | sed 's/kosmikos.example/YOUR-DOMAIN/g' | sudo tee /etc/nginx/sites-available/kosmikos >/dev/null
   sudo ln -s /etc/nginx/sites-available/kosmikos /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. Get the certificate (renewals reuse the same HTTP block automatically):
   ```bash
   sudo certbot certonly --webroot -w /var/www/certbot -d YOUR-DOMAIN
   ```
4. **Now the full config**:
   ```bash
   sed 's/kosmikos.example/YOUR-DOMAIN/g' deploy/nginx-kosmikos.conf | sudo tee /etc/nginx/sites-available/kosmikos >/dev/null
   sudo nginx -t && sudo systemctl reload nginx
   ```
   - nginx 1.25.1 or newer: change `listen 443 ssl http2;` to `listen 443 ssl;` and add `http2 on;`.
   - No IPv6 on the server: delete the `listen [::]...` lines.
5. In `.env` set `NODE_ENV=production`, then restart the app.
   **Only after HTTPS works**: in production the login cookie is HTTPS-only.

On a hosting platform instead of your own nginx: set `HOST=0.0.0.0` and
`TRUST_PROXY` to what the platform documents (often `1`).

**Check:**
- `curl -I http://YOUR-DOMAIN/login` → `301` to `https://`
- `curl -I https://YOUR-DOMAIN/login` shows `strict-transport-security`
- `curl -I http://YOUR-SERVER-IP:5000/login` from another machine **fails** to connect
- `BASE_URL=https://YOUR-DOMAIN npm test` passes
- Logging in through the browser works and stays logged in.
- An online TLS checker (e.g. SSL Labs) shows TLS 1.2/1.3 only.

## 3. Backups

`deploy/kosmikos-backup.sh` dumps the database and archives `uploads/`.
Uploads are not in git, so without this they have no copy at all.

1. Install the script and its database login (the `kosmikos_backup` account from step 1):
   ```bash
   sudo install -m 700 deploy/kosmikos-backup.sh /usr/local/bin/kosmikos-backup
   sudo mkdir -p /etc/kosmikos
   printf '[client]\nuser=kosmikos_backup\npassword=BACKUP_PASSWORD\n' | sudo tee /etc/kosmikos/backup.cnf >/dev/null
   sudo chmod 600 /etc/kosmikos/backup.cnf
   ```
2. Run daily at 03:17 (`/etc/cron.d/kosmikos-backup`):
   ```
   17 3 * * * root /usr/local/bin/kosmikos-backup >> /var/log/kosmikos-backup.log 2>&1
   ```
3. **Copy `/var/backups/kosmikos` to another machine or cloud storage.** A backup
   on the same disk is lost with it.

Settings (environment variables): `APP_DIR` (default `/srv/kosmikos`), `DEST`
(`/var/backups/kosmikos`), `KEEP_DAYS` (`14`). Each run stores a full copy of
`uploads/`, so disk use is about uploads size × `KEEP_DAYS`. Check free space.

**Check:**
- `sudo /usr/local/bin/kosmikos-backup` prints two file names; `ls -l /var/backups/kosmikos` shows them as `-rw-------`.
- Restore into a scratch database and compare counts (do this monthly):
  ```bash
  sudo mysql -e "CREATE DATABASE kosmikos_restore_test"
  gunzip -c /var/backups/kosmikos/db_LATEST.sql.gz | sudo mysql kosmikos_restore_test
  sudo mysql -e "SELECT COUNT(*) FROM kosmikos.users; SELECT COUNT(*) FROM kosmikos_restore_test.users"
  sudo mysql -e "DROP DATABASE kosmikos_restore_test"
  ```

## 4. Hash passwords still stored as plain text

Accounts created before hashing was added keep a plain-text password until
that user next logs in. This hashes all of them now.

1. Back up the users table, and make sure the column fits a hash (up to ~185 characters):
   ```bash
   sudo mysqldump kosmikos users > /root/users-before-hash.sql
   sudo mysql kosmikos -e "ALTER TABLE users MODIFY password VARCHAR(255) NOT NULL"
   ```
2. See how many there are, then hash them (uses `.env`):
   ```bash
   node scripts/hash-legacy-passwords.js --dry-run
   node scripts/hash-legacy-passwords.js
   ```
   It stops without changing anything if the column is too short, and is safe to run again.

**Check:**
- Running it again prints `0 with a plain-text password`.
- `sudo mysql kosmikos -e "SELECT COUNT(*) FROM users WHERE password NOT LIKE 'scrypt\$%'"` prints `0`.
- An existing user can still log in with their usual password.
- Once that's confirmed, delete `/root/users-before-hash.sql` (it contains the plain-text passwords).

## 5. Sessions table

Logins are stored in MySQL (they used to be in memory and were lost on every
restart). The app refuses to start until the table exists.

1. Create it (copy the `CREATE TABLE IF NOT EXISTS sessions` statement from `schema.sql`):
   ```bash
   sed -n '/CREATE TABLE IF NOT EXISTS sessions/,/);/p' schema.sql | sudo mysql kosmikos
   ```
2. Deploy the new code and restart. **Everyone is logged out once** (new cookie name).

Inactive users are logged out after `SESSION_IDLE_MINUTES` (default 120), and
everyone after 7 days. Changing a password logs out the user's other devices.
To rotate the session secret without logging everyone out: `SESSION_SECRET=new,old`.

**Check:**
- Log in, restart the app, reload the page: still logged in.
- Log in on two browsers, change the password in one: the other is logged out.

## 6. MySQL settings

`deploy/mysql-kosmikos.cnf`: only local connections, no `LOAD DATA LOCAL`.

```bash
sudo cp deploy/mysql-kosmikos.cnf /etc/mysql/mariadb.conf.d/99-kosmikos.cnf   # MariaDB
# or: sudo cp deploy/mysql-kosmikos.cnf /etc/mysql/mysql.conf.d/zz-kosmikos.cnf  # MySQL
sudo systemctl restart mariadb    # or: mysql
```

If you use a database GUI from your own computer, connect through an SSH tunnel
instead (`ssh -L 3306:127.0.0.1:3306 you@server`).

**Check:**
- `sudo mysql -e "SHOW VARIABLES WHERE Variable_name IN ('bind_address','local_infile')"` shows `127.0.0.1` and `OFF`.
- `sudo ss -ltn | grep 3306` shows `127.0.0.1:3306`, not `0.0.0.0` or `*`.
- `npm test` passes.

## 7. Run as its own user with tight file permissions

The app runs as user `kosmikos`, can't modify its own code, and can only
write to `uploads/`. Other users on the server can't read `.env` or uploads.

1. Create the user and install the code **without `.git`**:
   ```bash
   sudo useradd --system --home /srv/kosmikos --shell /usr/sbin/nologin kosmikos
   sudo mkdir -p /srv/kosmikos && git archive main | sudo tar -x -C /srv/kosmikos
   cd /srv/kosmikos && sudo npm ci --omit=dev
   ```
   Put `.env` in `/srv/kosmikos/` and copy existing uploads into `/srv/kosmikos/uploads/`.
2. Permissions:
   ```bash
   sudo chown -R root:kosmikos /srv/kosmikos
   sudo find /srv/kosmikos -type d -exec chmod 750 {} +
   sudo find /srv/kosmikos -type f -exec chmod 640 {} +
   sudo chown -R kosmikos:kosmikos /srv/kosmikos/uploads
   sudo chmod 750 /srv/kosmikos/uploads
   ```
3. Service: check `which node` matches `ExecStart` in `deploy/kosmikos.service`
   (change the path if not), then:
   ```bash
   sudo cp deploy/kosmikos.service /etc/systemd/system/
   sudo systemd-analyze verify /etc/systemd/system/kosmikos.service
   sudo systemctl daemon-reload && sudo systemctl enable --now kosmikos
   ```

The app's `.env` stays readable by the app (group `kosmikos`). Anything you
add later that writes files outside `uploads/` needs its own `ReadWritePaths`.

**Check:**
- `systemctl status kosmikos` is active; `npm test` passes.
- `sudo -u kosmikos touch /srv/kosmikos/x` → Permission denied.
- `sudo -u nobody cat /srv/kosmikos/.env` → Permission denied.
- A newly uploaded file is `-rw-r-----` owned by `kosmikos`.
