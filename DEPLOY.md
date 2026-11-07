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
