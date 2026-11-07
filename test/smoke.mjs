// End-to-end smoke test against a running server.
//   BASE_URL=http://localhost:5000 npm test
// Creates a throwaway account, exercises every feature, then deletes it.
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const BASE = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
let failures = 0;

function check(name, ok, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  -> ${detail}`}`);
    if (!ok) failures++;
}

class Client {
    constructor() { this.cookies = new Map(); }
    async req(method, path, { json, form, multipart, headers = {} } = {}) {
        const h = { ...headers };
        if (method !== "GET" && method !== "HEAD" && !("Origin" in h)) h.Origin = ORIGIN;
        if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
        let body;
        if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
        if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
        if (multipart) body = multipart;
        const res = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
        for (const c of res.headers.getSetCookie()) {
            const [pair, ...attrs] = c.split(";");
            const [k, v] = pair.split("=");
            const expired = attrs.some(a => /expires=thu, 01 jan 1970/i.test(a.trim()));
            if (expired || v === "") this.cookies.delete(k.trim()); else this.cookies.set(k.trim(), v);
        }
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        return { status: res.status, headers: res.headers, data, text };
    }
}

const id = randomBytes(4).toString("hex");
const email = `smoke-${id}@example.test`;
const pw1 = `Smoke-pass-${id}`, pw2 = `Smoke-pass2-${id}`;
const logo = new Blob([await readFile(new URL("../images/logo.png", import.meta.url))], { type: "image/png" });

const anon = new Client();
const a = new Client();

// --- Not public ---
for (const p of ["/index.js", "/.git/config", "/.env", "/package.json", "/node_modules/express/package.json"]) {
    const r = await anon.req("GET", p);
    check(`${p} is not served`, r.status === 404, r.status);
}
for (const p of ["/posts", "/api/user", "/search/users?query=a", "/api/profile/1", "/comments/1"]) {
    const r = await anon.req("GET", p);
    check(`${p} needs login`, r.status === 401, r.status);
}

// --- Signup / login ---
let r = await a.req("POST", "/", { form: { f_name: `Smoke ${id}`, username: `smoke_${id}`, email, password: pw1, confirm_password: pw1 } });
check("signup", r.status === 200 && /Signup successful/.test(r.text), r.status);
r = await a.req("POST", "/login", { form: { email, password: "wrong-password" } });
check("login rejects wrong password", r.status === 401, r.status);
r = await a.req("POST", "/login", { form: { email, password: pw1 } });
check("login", r.status === 302 && a.cookies.size > 0, r.status);

r = await a.req("GET", "/api/user");
check("GET /api/user", r.status === 200 && r.data.f_name === `Smoke ${id}`, JSON.stringify(r.data));
const pages = ["/home", "/profile", "/settings", "/about-us"];
for (const p of pages) {
    r = await a.req("GET", p);
    check(`page ${p}`, r.status === 200 && /<html/i.test(r.text), r.status);
}

// --- Posts ---
r = await a.req("POST", "/post/text", { json: { content: `smoke text ${id}` } });
check("text post", r.status === 201, r.status);
const fd = new FormData(); fd.append("file", logo, "logo.png");
r = await a.req("POST", "/post/image", { multipart: fd });
check("image upload", r.status === 201 && /^\/uploads\//.test(r.data.url || ""), JSON.stringify(r.data));
const imageUrl = r.data.url;
if (imageUrl) {
    const img = await a.req("GET", imageUrl);
    check("uploaded image is served", img.status === 200 && img.headers.get("content-type") === "image/png", img.status);
}
const bad = new FormData(); bad.append("file", new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "x.html");
r = await a.req("POST", "/post/image", { multipart: bad });
check("non-image upload rejected", r.status === 400, r.status);

r = await a.req("GET", "/posts");
const mine = Array.isArray(r.data) ? r.data.filter(p => p.content === `smoke text ${id}`) : [];
check("feed contains text post", mine.length === 1, r.status);
const postId = mine[0] && mine[0].id;

// --- Comments ---
r = await a.req("POST", "/comments", { json: { post_id: postId, content: `smoke comment ${id}` } });
check("add comment", r.status === 200 && r.data.comment_id, JSON.stringify(r.data));
const commentId = r.data.comment_id;
r = await a.req("GET", `/comments/${postId}`);
check("list comments", r.status === 200 && r.data.some(c => c.id === commentId), r.status);
r = await a.req("DELETE", `/comments/${commentId}`);
check("delete comment", r.status === 200, r.status);

// --- Search / profiles ---
r = await a.req("GET", `/search/users?query=${encodeURIComponent(`Smoke ${id}`)}`);
check("search users", r.status === 200 && r.data.length === 1, JSON.stringify(r.data));
const userId = r.data[0] && r.data[0].id;
r = await a.req("GET", `/search/posts?query=${encodeURIComponent(`smoke text ${id}`)}`);
check("search posts", r.status === 200 && r.data.length === 1, r.status);
r = await a.req("GET", `/api/profile/${userId}`);
check("view profile", r.status === 200 && r.data.posts.length >= 2, r.status);

// --- Profile update ---
const pf = new FormData(); pf.append("f_name", `Smoke ${id}`); pf.append("bio", "smoke bio"); pf.append("profile_picture", logo, "me.png");
r = await a.req("POST", "/api/user/update", { multipart: pf });
check("update profile + picture", r.status === 200 && /^\/uploads\//.test(r.data.profilePicPath || ""), JSON.stringify(r.data));

// --- CSRF ---
r = await a.req("POST", "/post/text", { json: { content: "csrf" }, headers: { Origin: "https://evil.example" } });
check("cross-site POST blocked", r.status === 403, r.status);

// --- Password change ---
r = await a.req("POST", "/api/settings/change-password", { json: { current_password: pw1, new_password: pw2 } });
check("change password", r.status === 200, JSON.stringify(r.data));

// --- Logout / login again ---
r = await a.req(process.env.LOGOUT_METHOD || "POST", "/logout");
if (r.status === 404) r = await a.req("GET", "/logout");
check("logout", r.status === 302, r.status);
r = await a.req("GET", "/api/user");
check("logged out", r.status === 401, r.status);
r = await a.req("POST", "/login", { form: { email, password: pw1 } });
check("old password rejected", r.status === 401, r.status);
r = await a.req("POST", "/login", { form: { email, password: pw2 } });
check("login with new password", r.status === 302, r.status);

// --- Delete account ---
r = await a.req("POST", "/api/settings/delete-account", { json: { password: "nope" } });
check("delete account needs right password", r.status === 401, r.status);
r = await a.req("POST", "/api/settings/delete-account", { json: { password: pw2 } });
check("delete account", r.status === 200, JSON.stringify(r.data));
r = await a.req("POST", "/login", { form: { email, password: pw2 } });
check("deleted account can't log in", r.status === 401, r.status);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
