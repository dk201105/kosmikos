# Deploying Kosmikos securely

Steps for the server that runs the site. Each step says how to check it worked.
`npm test` runs an end-to-end check against a running server
(`BASE_URL=https://your-domain npm test`); it creates and deletes a throwaway account.

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

1. Replace `kosmikos.example` with your domain in a copy of the config:
   ```bash
   sudo cp deploy/nginx-kosmikos.conf /etc/nginx/sites-available/kosmikos
   sudo sed -i 's/kosmikos.example/YOUR-DOMAIN/g' /etc/nginx/sites-available/kosmikos
   sudo ln -s /etc/nginx/sites-available/kosmikos /etc/nginx/sites-enabled/
   ```
   - nginx 1.25.1 or newer: change `listen 443 ssl http2;` to `listen 443 ssl;` and add `http2 on;`.
   - No IPv6 on the server: delete the two `listen [::]...` lines.
2. Get a certificate (the HTTP block serves the challenge):
   ```bash
   sudo mkdir -p /var/www/certbot
   sudo certbot certonly --webroot -w /var/www/certbot -d YOUR-DOMAIN
   ```
3. `sudo nginx -t && sudo systemctl reload nginx`
4. In `.env` set `NODE_ENV=production`, then restart the app.
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
