const express = require("express");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const mysql = require("mysql2");
const session = require("express-session");
const multer = require("multer");
const helmet = require("helmet");

// Load settings from a local .env file if there is one (see .env.example).
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch { /* no .env file */ }

const app = express();
const PORT = process.env.PORT || 5000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
// Which proxies may set X-Forwarded-For / X-Forwarded-Proto. Default: in
// production, only a proxy on this machine (nginx); otherwise none. On a
// hosting platform whose proxy is elsewhere, set TRUST_PROXY (e.g. "1").
const TRUST_PROXY = process.env.TRUST_PROXY;
app.set("trust proxy",
    TRUST_PROXY === undefined ? (IS_PRODUCTION ? "loopback" : false)
    : /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY)
    : TRUST_PROXY === "false" ? false
    : TRUST_PROXY);

// ---------- Security headers ----------
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],  // pages use inline <script>
            scriptSrcAttr: ["'unsafe-inline'"],        // home.html uses onclick="..."
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],                // data: = profile picture preview
            mediaSrc: ["'self'"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            ...(IS_PRODUCTION ? { upgradeInsecureRequests: [] } : {}),
        },
    },
    strictTransportSecurity: false,   // set by nginx, which terminates HTTPS
    referrerPolicy: { policy: "same-origin" },
}));
app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    next();
});

// ---------- Static files ----------
// Only these folders are public. The project root (source code, .git,
// package files, node_modules) is NOT served.
app.use(express.static(path.join(__dirname, "images")));
app.use("/images", express.static(path.join(__dirname, "images")));
app.use(express.static(path.join(__dirname, "styles")));

const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR, {
    dotfiles: "deny",
    setHeaders: (res) => {
        // Stop browsers from guessing a different type (e.g. treating a file as HTML).
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'");
    },
}));

// Client-side scripts that the pages load.
for (const file of ["profile.js", "settings.js"]) {
    app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
}

// Pages and API responses below may contain private data: don't let browsers
// or proxies keep copies. (Static files above keep normal caching.)
app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

// ---------- Body parsing ----------
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));

// ---------- Database ----------
for (const name of ["DB_USER", "DB_NAME"]) {
    if (!process.env[name]) console.warn(`${name} is not set; see .env.example`);
}

const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 10,
});

db.getConnection((err, conn) => {
    if (err) {
        console.error("Database connection failed:", err.message);
        return;
    }
    conn.release();
    console.log("MySQL connected");
});

function queryDB(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });
}

// ---------- Sessions ----------
// Stored in MySQL (table `sessions`, see schema.sql): they survive restarts,
// expire on their own, and can be revoked per user.
class MySQLSessionStore extends session.Store {
    constructor(pool) {
        super();
        this.pool = pool;
        setInterval(() => pool.query("DELETE FROM sessions WHERE expires < NOW()", () => {}), 15 * 60 * 1000).unref();
    }
    get(sid, cb) {
        this.pool.query("SELECT data FROM sessions WHERE sid = ? AND expires > NOW()", [sid], (err, rows) => {
            if (err) return cb(err);
            if (!rows.length) return cb(null, null);
            try { cb(null, JSON.parse(rows[0].data)); } catch (e) { cb(e); }
        });
    }
    set(sid, sess, cb) {
        this.pool.query(
            "REPLACE INTO sessions (sid, user_id, data, expires) VALUES (?, ?, ?, ?)",
            [sid, sess.user ? sess.user.id : null, JSON.stringify(sess), new Date(sess.cookie.expires)],
            (err) => cb && cb(err));
    }
    touch(sid, sess, cb) {
        this.pool.query("UPDATE sessions SET expires = ? WHERE sid = ?", [new Date(sess.cookie.expires), sid], (err) => cb && cb(err));
    }
    destroy(sid, cb) {
        this.pool.query("DELETE FROM sessions WHERE sid = ?", [sid], (err) => cb && cb(err));
    }
}

// Without the table every request would fail, so refuse to start instead.
db.query("SELECT 1 FROM sessions LIMIT 1", (err) => {
    if (err && err.code === "ER_NO_SUCH_TABLE") {
        console.error("The sessions table is missing. Create it with the CREATE TABLE sessions statement in schema.sql.");
        process.exit(1);
    }
});

const SESSION_COOKIE = IS_PRODUCTION ? "__Host-kosmikos.sid" : "kosmikos.sid";
const SESSION_IDLE_MS = (Number(process.env.SESSION_IDLE_MINUTES) || 120) * 60 * 1000;
const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;   // log in again after 7 days regardless
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    if (IS_PRODUCTION) {
        console.error("SESSION_SECRET must be set in production.");
        process.exit(1);
    }
    sessionSecret = crypto.randomBytes(32).toString("hex");
    console.warn("SESSION_SECRET not set: using a random one (everyone is logged out on restart).");
}

app.use(session({
    name: SESSION_COOKIE,
    secret: sessionSecret.split(","),   // to rotate: SESSION_SECRET=new,old
    store: new MySQLSessionStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,                      // inactivity timer restarts on each request
    cookie: {
        httpOnly: true,
        sameSite: "lax",                // not sent on cross-site POSTs
        secure: IS_PRODUCTION,          // HTTPS-only in production
        path: "/",
        maxAge: SESSION_IDLE_MS,
    },
}));

// Absolute session lifetime.
app.use((req, res, next) => {
    if (req.session.user && Date.now() - (req.session.createdAt || 0) > SESSION_MAX_MS) {
        return req.session.regenerate(() => next());
    }
    next();
});

// ---------- CSRF protection ----------
// Reject state-changing requests that come from another website.
app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const source = req.get("origin") || req.get("referer");
    if (!source) return next(); // non-browser clients; the SameSite cookie still applies
    let sourceHost;
    try { sourceHost = new URL(source).host; } catch { sourceHost = null; }
    if (sourceHost !== req.get("host")) {
        return res.status(403).json({ error: "Cross-site request blocked" });
    }
    next();
});

// ---------- Password hashing (see passwords.js) ----------
const { hashPassword, verifyPassword } = require("./passwords");

// Checked when the email doesn't exist, so a wrong email takes as long as a
// wrong password (otherwise response time reveals which emails have accounts).
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

const MIN_PASSWORD_LENGTH = 8;

// ---------- Login rate limiting ----------
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;             // per IP + email
const LOGIN_MAX_FAILURES_PER_EMAIL = 50;   // per email from any IP (stops IP rotation)
const loginFailures = new Map(); // key -> { count, first }

function loginKeys(req, email) {
    const e = String(email || "").toLowerCase();
    return [[`ip|${req.ip}|${e}`, LOGIN_MAX_FAILURES], [`email|${e}`, LOGIN_MAX_FAILURES_PER_EMAIL]];
}

function isLoginBlocked(keys) {
    return keys.some(([key, max]) => {
        const entry = loginFailures.get(key);
        if (!entry) return false;
        if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
            loginFailures.delete(key);
            return false;
        }
        return entry.count >= max;
    });
}

function recordLoginFailure(key) {
    const entry = loginFailures.get(key);
    if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
        loginFailures.set(key, { count: 1, first: Date.now() });
    } else {
        entry.count++;
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of loginFailures) {
        if (now - entry.first > LOGIN_WINDOW_MS) loginFailures.delete(key);
    }
}, LOGIN_WINDOW_MS).unref();

// ---------- Auth middleware ----------
const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    next();
};

const requireApiAuth = (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Not authenticated" });
    next();
};

// Small helper for the alert-and-redirect responses used by the HTML forms.
function alertAndRedirect(res, status, message, location) {
    res.status(status).send(
        `<script>alert(${JSON.stringify(message)}); window.location.href=${JSON.stringify(location)};</script>`
    );
}

// ---------- Pages ----------
const page = (file) => (req, res) => res.sendFile(path.join(__dirname, file));

app.get("/", page("signup.html"));
app.get("/login", page("login.html"));
app.get("/home", requireAuth, page("home.html"));
app.get("/about-us", requireAuth, page("about_us.html"));
app.get("/profile", requireAuth, page("profile.html"));
app.get("/settings", requireAuth, page("settings.html"));
app.get("/profile/:id", requireAuth, page("user_profile.html"));

// ---------- Signup ----------
app.post("/", async (req, res) => {
    const { f_name, username, email, password, confirm_password } = req.body;

    if (!f_name || !username || !email || !password) {
        return alertAndRedirect(res, 400, "All fields are required!", "/");
    }
    if (password !== confirm_password) {
        return alertAndRedirect(res, 400, "Passwords do not match!", "/");
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        return alertAndRedirect(res, 400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, "/");
    }

    try {
        const hash = await hashPassword(password);
        await queryDB(
            "INSERT INTO users (f_name, username, email, password) VALUES (?, ?, ?, ?)",
            [f_name, username, email, hash]
        );
        alertAndRedirect(res, 200, "Signup successful!", "/login");
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return alertAndRedirect(res, 409, "That email or username is already in use.", "/");
        }
        console.error("Error inserting user:", err.message);
        alertAndRedirect(res, 500, "Signup failed. Please try again.", "/");
    }
});

// ---------- Login ----------
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return alertAndRedirect(res, 400, "Please enter email and password", "/login");
    }

    const keys = loginKeys(req, email);
    if (isLoginBlocked(keys)) {
        return alertAndRedirect(res, 429, "Too many failed attempts. Try again in 15 minutes.", "/login");
    }

    try {
        const results = await queryDB("SELECT id, f_name, email, password FROM users WHERE email = ?", [email]);
        const user = results[0];
        const { ok, needsRehash } = await verifyPassword(password, user ? user.password : await DUMMY_HASH);

        if (!user || !ok) {
            for (const [key] of keys) recordLoginFailure(key);
            return alertAndRedirect(res, 401, "Invalid Email or Password", "/login");
        }
        loginFailures.delete(keys[0][0]);

        if (needsRehash) {
            try {
                await queryDB("UPDATE users SET password = ? WHERE id = ?", [await hashPassword(password), user.id]);
            } catch (err) {
                // Most likely the password column is too short; see README.
                console.error("Could not upgrade password hash for user", user.id, "-", err.message);
            }
        }

        // New session ID on login (prevents session fixation).
        req.session.regenerate((err) => {
            if (err) {
                console.error("Session error:", err.message);
                return alertAndRedirect(res, 500, "Server Error. Try again!", "/login");
            }
            req.session.user = { id: user.id, f_name: user.f_name, email: user.email };
            req.session.createdAt = Date.now();
            res.redirect("/profile");
        });
    } catch (err) {
        console.error("Error logging in:", err.message);
        alertAndRedirect(res, 500, "Server Error. Try again!", "/login");
    }
});

// ---------- Logout ----------
app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.clearCookie(SESSION_COOKIE, { path: "/" });
        res.redirect("/login");
    });
});

// ---------- File uploads ----------
// Only these types are accepted, and the saved file's extension comes from
// this list - never from the uploaded file's name.
const ALLOWED_UPLOADS = {
    image: {
        "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
    },
    video: {
        "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/ogg": ".ogv",
    },
    audio: {
        "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav",
        "audio/wave": ".wav", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a",
        "audio/aac": ".aac", "audio/webm": ".weba",
    },
};

function uploaderFor(kind) {
    const types = ALLOWED_UPLOADS[kind];
    return multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => cb(null, UPLOAD_DIR),
            filename: (req, file, cb) =>
                cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${types[file.mimetype]}`),
        }),
        limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10MB
        fileFilter: (req, file, cb) => {
            if (types[file.mimetype]) return cb(null, true);
            const err = new Error(`Only ${kind} files (${Object.values(types).join(", ")}) are allowed`);
            err.status = 400;
            cb(err);
        },
    });
}

const upload = {
    image: uploaderFor("image"),
    video: uploaderFor("video"),
    audio: uploaderFor("audio"),
};

// ---------- Upload limits ----------
// Per user: at most UPLOAD_MAX_PER_HOUR files. Overall: refuse uploads when the
// disk is nearly full, so uploads can never take the database down with it.
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;
const UPLOAD_MAX_PER_HOUR = Number(process.env.UPLOAD_MAX_PER_HOUR) || 30;
const MIN_FREE_DISK_BYTES = (Number(process.env.MIN_FREE_DISK_MB) || 500) * 1024 * 1024;
const uploadCounts = new Map(); // userId -> { count, first }

function uploadEntry(userId) {
    let entry = uploadCounts.get(userId);
    if (!entry || Date.now() - entry.first > UPLOAD_WINDOW_MS) {
        entry = { count: 0, first: Date.now() };
        uploadCounts.set(userId, entry);
    }
    return entry;
}

const overUploadLimit = (req) => uploadEntry(req.session.user.id).count >= UPLOAD_MAX_PER_HOUR;
const uploadLimitResponse = (res) => res.status(429).json({ error: "Upload limit reached. Try again later." });

// Runs before multer, so nothing is written to disk. Routes where the file is
// optional (profile update) skip the per-user check here; countUpload does it.
const checkUploadQuota = (fileRequired) => async (req, res, next) => {
    if (fileRequired && overUploadLimit(req)) return uploadLimitResponse(res);
    try {
        const { bavail, bsize } = await fs.promises.statfs(UPLOAD_DIR);
        if (bavail * bsize < MIN_FREE_DISK_BYTES) {
            console.error("Uploads refused: disk almost full");
            return res.status(507).json({ error: "Uploads are temporarily unavailable." });
        }
    } catch (err) {
        console.error("Could not check free disk space:", err.message);
    }
    next();
};

// Runs after multer: only requests that actually stored a file count.
function countUpload(req, res, next) {
    if (!req.file) return next();
    if (overUploadLimit(req)) {
        fs.promises.unlink(req.file.path).catch(() => {});
        return uploadLimitResponse(res);
    }
    uploadEntry(req.session.user.id).count++;
    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of uploadCounts) {
        if (now - entry.first > UPLOAD_WINDOW_MS) uploadCounts.delete(id);
    }
}, UPLOAD_WINDOW_MS).unref();

// ---------- Current user ----------
const DEFAULT_PROFILE_PIC = "/images/default_profile_pic.jpg";

app.get("/api/user", requireApiAuth, async (req, res) => {
    try {
        const results = await queryDB("SELECT f_name, bio, profile_picture FROM users WHERE id = ?", [req.session.user.id]);
        if (results.length === 0) return res.status(404).json({ error: "User not found" });
        const user = results[0];
        res.json({
            f_name: user.f_name,
            bio: user.bio || "",
            profile_picture: user.profile_picture || DEFAULT_PROFILE_PIC,
        });
    } catch (err) {
        console.error("Failed to fetch user data:", err.message);
        res.status(500).json({ error: "Failed to fetch user data" });
    }
});

app.post("/api/user/update", requireApiAuth, checkUploadQuota(false), upload.image.single("profile_picture"), countUpload, async (req, res) => {
    const { f_name, bio } = req.body;
    if (!f_name) return res.status(400).json({ error: "Name is required" });

    const profilePicPath = req.file ? `/uploads/${req.file.filename}` : null;
    let sql = "UPDATE users SET f_name = ?, bio = ?";
    const params = [f_name, bio || ""];
    if (profilePicPath) {
        sql += ", profile_picture = ?";
        params.push(profilePicPath);
    }
    sql += " WHERE id = ?";
    params.push(req.session.user.id);

    try {
        await queryDB(sql, params);
        req.session.user.f_name = f_name;
        res.json({ message: "Profile updated successfully!", profilePicPath });
    } catch (err) {
        console.error("Profile update failed:", err.message);
        res.status(500).json({ error: "Database update failed" });
    }
});

// ---------- Posts ----------
async function insertPost(req, res, type, content, okMessage, extra = {}) {
    try {
        await queryDB("INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)", [req.session.user.id, type, content]);
        res.status(201).json({ message: okMessage, ...extra });
    } catch (err) {
        console.error(`Error saving ${type} post:`, err.message);
        res.status(500).json({ error: "Database error" });
    }
}

app.post("/post/text", requireApiAuth, (req, res) => {
    const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
    if (!content) return res.status(400).json({ error: "Text content is required" });
    insertPost(req, res, "text", content, "Text post added successfully");
});

for (const kind of ["image", "video", "audio"]) {
    app.post(`/post/${kind}`, requireApiAuth, checkUploadQuota(true), upload[kind].single("file"), countUpload, (req, res) => {
        if (!req.file) return res.status(400).json({ error: `${kind} file is required` });
        const url = `/uploads/${req.file.filename}`;
        insertPost(req, res, kind, url, `${kind[0].toUpperCase() + kind.slice(1)} post added successfully`, { url });
    });
}

app.post("/post/link", requireApiAuth, (req, res) => {
    const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
    let valid = false;
    try {
        valid = ["http:", "https:"].includes(new URL(content).protocol);
    } catch { /* invalid URL */ }
    if (!valid) {
        return res.status(400).json({ error: "A valid link (starting with http/https) is required!" });
    }
    insertPost(req, res, "link", content, "Link posted successfully!", { link: content });
});

app.get("/posts", requireApiAuth, async (req, res) => {
    try {
        const posts = await queryDB(`
            SELECT p.*, u.f_name, u.profile_picture
            FROM posts p
            JOIN users u ON p.user_id = u.id
            ORDER BY p.created_at DESC
        `);
        res.json(posts);
    } catch (err) {
        console.error("Error fetching posts:", err.message);
        res.status(500).json({ error: "Failed to fetch posts" });
    }
});

// ---------- Search ----------
// Escape LIKE wildcards so a search for "%" doesn't match everything.
const likePattern = (s) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

app.get("/search/users", requireApiAuth, async (req, res) => {
    const q = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!q) return res.status(400).json({ error: "Search query is required" });
    try {
        res.json(await queryDB("SELECT id, f_name, profile_picture FROM users WHERE f_name LIKE ? LIMIT 10", [likePattern(q)]));
    } catch (err) {
        console.error("Error searching users:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});

app.get("/search/posts", requireApiAuth, async (req, res) => {
    const q = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!q) return res.status(400).json({ error: "Search query is required" });
    try {
        res.json(await queryDB(`
            SELECT p.id, p.user_id, p.type, p.content, p.created_at,
                   u.f_name, u.username, u.profile_picture
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.content LIKE ?
            ORDER BY p.created_at DESC
            LIMIT 20
        `, [likePattern(q)]));
    } catch (err) {
        console.error("Error searching posts:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});

// ---------- Other users' profiles ----------
app.get("/api/profile/:id", requireApiAuth, async (req, res) => {
    try {
        const users = await queryDB("SELECT id, f_name, profile_picture, bio FROM users WHERE id = ?", [req.params.id]);
        if (users.length === 0) return res.status(404).json({ error: "User not found" });
        const posts = await queryDB("SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC", [req.params.id]);
        res.json({ user: users[0], posts });
    } catch (err) {
        console.error("Error fetching profile:", err.message);
        res.status(500).json({ error: "Server error" });
    }
});

// ---------- Comments ----------
app.post("/comments", requireApiAuth, async (req, res) => {
    const { post_id } = req.body;
    const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
    if (!post_id || !content) return res.status(400).json({ error: "Post ID and content are required." });
    try {
        const result = await queryDB("INSERT INTO comments (user_id, post_id, content) VALUES (?, ?, ?)",
            [req.session.user.id, post_id, content]);
        res.json({ message: "Comment added successfully!", comment_id: result.insertId });
    } catch (err) {
        console.error("Error adding comment:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});

app.get("/comments/:post_id", requireApiAuth, async (req, res) => {
    try {
        res.json(await queryDB(`
            SELECT comments.*, users.f_name AS username, users.profile_picture
            FROM comments
            JOIN users ON comments.user_id = users.id
            WHERE comments.post_id = ?
            ORDER BY comments.created_at ASC
        `, [req.params.post_id]));
    } catch (err) {
        console.error("Error fetching comments:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});

app.delete("/comments/:id", requireApiAuth, async (req, res) => {
    try {
        const result = await queryDB("DELETE FROM comments WHERE id = ? AND user_id = ?", [req.params.id, req.session.user.id]);
        if (result.affectedRows === 0) return res.status(403).json({ error: "Unauthorized or comment not found." });
        res.json({ message: "Comment deleted successfully!" });
    } catch (err) {
        console.error("Error deleting comment:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});

// ---------- Settings ----------
async function checkCurrentPassword(userId, password) {
    const results = await queryDB("SELECT password FROM users WHERE id = ?", [userId]);
    if (results.length === 0) return false;
    return (await verifyPassword(password, results[0].password)).ok;
}

app.post("/api/settings/change-password", requireApiAuth, async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
        return res.status(400).json({ error: "Current and new passwords are required." });
    }
    if (new_password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }
    try {
        if (!(await checkCurrentPassword(req.session.user.id, current_password))) {
            return res.status(401).json({ error: "Current password is incorrect" });
        }
        await queryDB("UPDATE users SET password = ? WHERE id = ?", [await hashPassword(new_password), req.session.user.id]);
        // Log out every other device.
        await queryDB("DELETE FROM sessions WHERE user_id = ? AND sid <> ?", [req.session.user.id, req.sessionID]);
        res.json({ message: "Password updated successfully!" });
    } catch (err) {
        console.error("Error updating password:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});

app.post("/api/settings/delete-account", requireApiAuth, async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Enter your password to delete your account." });
    try {
        if (!(await checkCurrentPassword(req.session.user.id, password))) {
            return res.status(401).json({ error: "Password is incorrect" });
        }
        await queryDB("DELETE FROM users WHERE id = ?", [req.session.user.id]);
        req.session.destroy((err) => {
            if (err) console.error("Error destroying session:", err.message);
            res.clearCookie(SESSION_COOKIE, { path: "/" });
            res.json({ message: "Account deleted successfully!" });
        });
    } catch (err) {
        console.error("Error deleting account:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});

// ---------- 404 ----------
app.use((req, res) => res.status(404).type("text").send("Not found"));

// ---------- Errors ----------
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.status === 400) {
        return res.status(400).json({ error: err.message });
    }
    if (err.type === "entity.too.large") {
        return res.status(413).json({ error: "Request too large" });
    }
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Server error" });
});

// Only reachable from this machine by default (i.e. through nginx).
// On a hosting platform that requires it, set HOST=0.0.0.0.
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => console.log(`Server running on http://${HOST}:${PORT}`));
