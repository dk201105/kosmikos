// Unit tests for passwords.js (no server or database needed):  npm run test:unit
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { hashPassword, verifyPassword, isHashed } = require("../passwords.js");

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log(`PASS  ${name}`); }
    catch (err) { failures++; console.log(`FAIL  ${name}\n      ${err.message}`); }
}

// Hashes made by the previous version of passwords.js (format scrypt$salt$key,
// Node default cost). Real users' passwords look like this until they log in.
const V1 = [
    ["correct horse battery", "scrypt$efa10ffb15061fc32d3b49eee2c1bb5c$84a6f6fc691135834fc3d4823926900f03b62db0cd740228bf9d4c5def892609764c006faf44cc54afba2bf56be5f7fd16e95b4c6816c7d85bac8e5b6585f904"],
    ["pa ss wörd 2", "scrypt$a0689f6f683bc9912f1ee6f1406af839$0684a9c0e104a0ed4bbe66055e5768be73659bac1e965e922a03059023cd07ca3e003fb95de694312055ba6c6e9d3d672a01a9081b09530937863d7becca012d"],
    ["x".repeat(200), "scrypt$86204876ccc69ac2494ce9131c564577$43d605672a33726399239e0557cc4db9c68fa4139f8e8648fea9e82ba103dec569cdafcc04cfe627e30daa421c0a7be06ded55b4936fa3778440a8df780bfa4c"],
];

await test("old-format hashes still verify", async () => {
    for (const [pw, hash] of V1) {
        assert.deepEqual(await verifyPassword(pw, hash), { ok: true, needsRehash: true }, pw.slice(0, 20));
    }
});

await test("old-format hashes reject wrong passwords", async () => {
    for (const [pw, hash] of V1) {
        assert.deepEqual(await verifyPassword(pw + "!", hash), { ok: false, needsRehash: false });
    }
});

await test("new hashes use the v2 format and verify", async () => {
    const hash = await hashPassword("new password 1");
    assert.match(hash, /^scrypt\$v2\$\d+\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.ok(hash.length <= 190, `length ${hash.length}`);
    assert.deepEqual(await verifyPassword("new password 1", hash), { ok: true, needsRehash: false });
    assert.deepEqual(await verifyPassword("new password 2", hash), { ok: false, needsRehash: false });
});

await test("upgrading an old hash keeps the same password working", async () => {
    const [pw, oldHash] = V1[1];
    const { ok, needsRehash } = await verifyPassword(pw, oldHash);
    assert.ok(ok && needsRehash);
    const upgraded = await hashPassword(pw);
    assert.deepEqual(await verifyPassword(pw, upgraded), { ok: true, needsRehash: false });
});

await test("v2 hash with a different cost verifies and asks for rehash", async () => {
    // Same password hashed at N=2^14 in v2 format (as if SCRYPT_COST was 14).
    const crypto = await import("node:crypto");
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync("cost change", salt, 64, { N: 2 ** 14, r: 8, p: 1 });
    const hash = `scrypt$v2$16384$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
    assert.deepEqual(await verifyPassword("cost change", hash), { ok: true, needsRehash: true });
});

await test("plain-text passwords (before hashing) still verify and ask for rehash", async () => {
    assert.deepEqual(await verifyPassword("plainpass1", "plainpass1"), { ok: true, needsRehash: true });
    assert.deepEqual(await verifyPassword("plainpass2", "plainpass1"), { ok: false, needsRehash: false });
    assert.equal(isHashed("plainpass1"), false);
});

await test("corrupted or hostile hash strings fail closed, never throw", async () => {
    const good = await hashPassword("x");
    for (const bad of [
        "scrypt$", "scrypt$$", "scrypt$zz$zz", "scrypt$v2$16384$8$1$abcd", "scrypt$v2$1000$8$1$aa$bb",
        "scrypt$v2$4294967296$8$1$aa$bb", "scrypt$v2$16384$999$1$aa$bb", "scrypt$v2$16384$8$1$aa$abc",
        good.slice(0, -2), good + "$extra",
    ]) {
        assert.deepEqual(await verifyPassword("x", bad), { ok: false, needsRehash: false }, bad);
    }
    assert.deepEqual(await verifyPassword({}, good), { ok: false, needsRehash: false });
    assert.deepEqual(await verifyPassword("x", null), { ok: false, needsRehash: false });
});

console.log(failures ? `\n${failures} test(s) failed` : "\nAll password tests passed");
process.exit(failures ? 1 : 0);
