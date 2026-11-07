-- Database accounts for Kosmikos. See DEPLOY.md, step 1.
--
-- Run as a MySQL admin, e.g.:   sudo mysql   (or: mysql -u root -p)
-- Replace every CHANGE_ME_* value with a new random password first, e.g. from:
--   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
-- Don't commit the file with real passwords in it.

-- 1. The old root password is in this repo's git history: change it.
ALTER USER 'root'@'localhost' IDENTIFIED BY 'CHANGE_ME_ROOT';

-- 2. The app's own account: can read and write rows, nothing else
--    (cannot drop tables, create users, read other databases or files).
CREATE USER IF NOT EXISTS 'kosmikos_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_APP';
ALTER USER 'kosmikos_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_APP';
GRANT SELECT, INSERT, UPDATE, DELETE ON kosmikos.* TO 'kosmikos_app'@'localhost';

-- 3. Read-only account for backups (deploy/kosmikos-backup.sh).
CREATE USER IF NOT EXISTS 'kosmikos_backup'@'localhost' IDENTIFIED BY 'CHANGE_ME_BACKUP';
ALTER USER 'kosmikos_backup'@'localhost' IDENTIFIED BY 'CHANGE_ME_BACKUP';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON kosmikos.* TO 'kosmikos_backup'@'localhost';

FLUSH PRIVILEGES;
