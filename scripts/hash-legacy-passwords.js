// One-off: hash every password still stored as plain text.
//   node scripts/hash-legacy-passwords.js            (uses .env)
//   node scripts/hash-legacy-passwords.js --dry-run  (only count them)
// Safe to run more than once. Back up the users table first (DEPLOY.md step 4).
const path = require("path");
const mysql = require("mysql2/promise");
const { hashPassword, isHashed } = require("../passwords");

if (typeof process.loadEnvFile !== "function") {
    console.error(`Node ${process.version} is too old: Kosmikos needs Node 20.12 or newer (to read .env).`);
    process.exit(1);
}
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch { /* no .env */ }
const DRY_RUN = process.argv.includes("--dry-run");
const MIN_COLUMN_LENGTH = 190; // hashes are up to ~185 characters

(async () => {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });
    try {
        // A column that's too short would cut hashes off and lock users out.
        const [[col]] = await db.query(
            `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password'`);
        if (!col || col.len < MIN_COLUMN_LENGTH) {
            console.error(`users.password holds ${col ? col.len : "?"} characters; hashes need ${MIN_COLUMN_LENGTH}.`);
            console.error("Run first:  ALTER TABLE users MODIFY password VARCHAR(255) NOT NULL;");
            process.exitCode = 1;
            return;
        }

        const [rows] = await db.query("SELECT id, password FROM users");
        const plain = rows.filter((r) => !isHashed(r.password));
        console.log(`${rows.length} users, ${plain.length} with a plain-text password.`);
        if (DRY_RUN || plain.length === 0) return;

        let done = 0;
        for (const { id, password } of plain) {
            // Only update if it hasn't changed since we read it (e.g. the user just logged in).
            const [res] = await db.query("UPDATE users SET password = ? WHERE id = ? AND password = ?",
                [await hashPassword(password), id, password]);
            done += res.affectedRows;
        }
        console.log(`Hashed ${done} password(s).`);
    } finally {
        await db.end();
    }
})().catch((err) => {
    console.error("Failed:", err.message);
    process.exitCode = 1;
});
