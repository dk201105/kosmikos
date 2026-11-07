// Password hashing with scrypt (built into Node, no native build needed).
const crypto = require("crypto");

const HASH_PREFIX = "scrypt$";

function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.scrypt(password, salt, 64, (err, key) => {
            if (err) return reject(err);
            resolve(`${HASH_PREFIX}${salt.toString("hex")}$${key.toString("hex")}`);
        });
    });
}

function safeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Returns { ok, needsRehash }. Accounts created before hashing was added
// still hold a plain-text password; those are upgraded on the next login.
function verifyPassword(password, stored) {
    return new Promise((resolve, reject) => {
        if (typeof stored !== "string" || typeof password !== "string") {
            return resolve({ ok: false, needsRehash: false });
        }
        if (!stored.startsWith(HASH_PREFIX)) {
            return resolve({ ok: safeEqual(password, stored), needsRehash: true });
        }
        const [saltHex, keyHex] = stored.slice(HASH_PREFIX.length).split("$");
        if (!saltHex || !keyHex) return resolve({ ok: false, needsRehash: false });
        const expected = Buffer.from(keyHex, "hex");
        crypto.scrypt(password, Buffer.from(saltHex, "hex"), expected.length, (err, key) => {
            if (err) return reject(err);
            resolve({ ok: crypto.timingSafeEqual(key, expected), needsRehash: false });
        });
    });
}

function isHashed(stored) {
    return typeof stored === "string" && stored.startsWith(HASH_PREFIX);
}

module.exports = { hashPassword, verifyPassword, isHashed, HASH_PREFIX };
