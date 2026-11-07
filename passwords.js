// Password hashing with scrypt (built into Node, no native build needed).
//
// Stored formats:
//   scrypt$v2$<N>$<r>$<p>$<salt hex>$<key hex>   current: cost saved with the hash
//   scrypt$<salt hex>$<key hex>                  older: Node defaults (N=2^14, r=8, p=1)
//   anything else                                plain text from before hashing existed
// Old formats still verify and are upgraded on the next successful login.
const crypto = require("crypto");

const HASH_PREFIX = "scrypt$";

// Cost: N = 2^SCRYPT_COST. Each step doubles time and memory per login.
// 16 -> ~64 MB, 17 -> ~128 MB (what I believe OWASP recommends; use it on
// servers with 2 GB+ RAM). Up to 4 logins run at once (Node's thread pool).
const COST = Math.min(Math.max(Number(process.env.SCRYPT_COST) || 16, 14), 20);
const CURRENT = { N: 2 ** COST, r: 8, p: 1 };
const LEGACY_V1 = { N: 2 ** 14, r: 8, p: 1 };
const KEY_LENGTH = 64;

const maxmem = ({ N, r }) => 2 * 128 * N * r; // scrypt needs 128*N*r bytes

function scrypt(password, salt, keylen, params) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, keylen, { ...params, maxmem: maxmem(params) },
            (err, key) => (err ? reject(err) : resolve(key)));
    });
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, KEY_LENGTH, CURRENT);
    const { N, r, p } = CURRENT;
    return `${HASH_PREFIX}v2$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

function safeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

const HEX = /^[0-9a-f]+$/i;
const isPowerOfTwo = (n) => Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;

// Returns { params, saltHex, keyHex } or null if the string isn't a valid hash.
function parseHash(stored) {
    const parts = stored.split("$");
    let params, saltHex, keyHex;
    if (parts[1] === "v2" && parts.length === 7) {
        params = { N: Number(parts[2]), r: Number(parts[3]), p: Number(parts[4]) };
        [saltHex, keyHex] = [parts[5], parts[6]];
        // Refuse absurd values rather than burn CPU/memory on a corrupted row.
        if (!isPowerOfTwo(params.N) || params.N > 2 ** 20 || params.r < 1 || params.r > 32
            || params.p < 1 || params.p > 16) return null;
    } else if (parts.length === 3) {
        params = LEGACY_V1;
        [saltHex, keyHex] = [parts[1], parts[2]];
    } else {
        return null;
    }
    // Exact lengths only: a shorter key is a prefix of the full one, so a
    // truncated hash (e.g. a too-short column) would still "verify", and be
    // much easier to crack.
    if (saltHex.length !== 32 || keyHex.length !== KEY_LENGTH * 2 || !HEX.test(saltHex) || !HEX.test(keyHex)) {
        return null;
    }
    return { params, saltHex, keyHex };
}

const sameParams = (a, b) => a.N === b.N && a.r === b.r && a.p === b.p;

// Returns { ok, needsRehash }. needsRehash is only ever true when ok is true.
async function verifyPassword(password, stored) {
    if (typeof stored !== "string" || typeof password !== "string") {
        return { ok: false, needsRehash: false };
    }
    if (!stored.startsWith(HASH_PREFIX)) {
        const ok = safeEqual(password, stored); // plain text from before hashing
        return { ok, needsRehash: ok };
    }
    const parsed = parseHash(stored);
    if (!parsed) return { ok: false, needsRehash: false };
    const expected = Buffer.from(parsed.keyHex, "hex");
    const key = await scrypt(password, Buffer.from(parsed.saltHex, "hex"), expected.length, parsed.params);
    const ok = crypto.timingSafeEqual(key, expected);
    const isCurrent = stored.startsWith(`${HASH_PREFIX}v2$`) && sameParams(parsed.params, CURRENT);
    return { ok, needsRehash: ok && !isCurrent };
}

function isHashed(stored) {
    return typeof stored === "string" && stored.startsWith(HASH_PREFIX);
}

module.exports = { hashPassword, verifyPassword, isHashed, HASH_PREFIX };
