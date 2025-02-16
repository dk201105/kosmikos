const express = require('express');
const path = require('path');
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const nodemailer = require("nodemailer");
const session = require("express-session");
const multer = require("multer");

const app = express();
const PORT = 5000;

app.use(express.static(__dirname));
// Middleware Configuration
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, "/images")));
app.use(express.static(path.join(__dirname, "/styles")));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session Middleware
app.use(session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Database Connection
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "divya1111",
    database: "kosmikos",
});

db.connect((err) => {
    if (err) {
        console.error("Database connection failed:", err);
        return;
    }
    console.log("MySQL connected");
});

// ✅ Middleware to Protect Routes
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
};

// ✅ Protected Routes
app.get("/home", requireAuth, (req, res) => res.sendFile(path.join(__dirname, "home.html")));
app.get("/about-us", requireAuth, (req, res) => res.sendFile(path.join(__dirname, "about_us.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "signup.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/profile", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "profile.html"));  // If stored in 'views' folder
});

// ✅ Login Route (Unchanged)
app.post("/login", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).send('<script>alert("Please enter email and password"); window.location.href="/login";</script>');
    }

    const query = "SELECT * FROM users WHERE email = ? AND password = ?";
    db.query(query, [email, password], (err, results) => {
        if (err) {
            console.error("Error logging in:", err);
            return res.status(500).send('<script>alert("Server Error. Try again!"); window.location.href="/login";</script>');
        }

        if (results.length > 0) {
            req.session.user = {
                id: results[0].id,
                f_name: results[0].f_name,
                email: results[0].email
            };
            res.redirect('/profile');
        } else {
            res.status(401).send('<script>alert("Invalid Email or Password"); window.location.href="/login";</script>');
        }
    });
});

// ✅ Configure Multer for File Uploads (Unchanged)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    },
});

const upload = multer({ storage: storage });

// ✅ API to Fetch User Data
app.get("/api/user", requireAuth, (req, res) => {
    const userId = req.session.user.id;
    db.query("SELECT f_name, bio, followers, following, likes, profile_pic FROM users WHERE id = ?", 
    [userId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: "Database error" });
        }
        res.json(results[0]);  // Return user details as JSON
    });
});


// ✅ Route to Post Text (Now Linked to User)
app.post("/post/text", requireAuth, (req, res) => {
    const { content } = req.body;
    if (!content) {
        return res.status(400).json({ error: "Text content is required" });
    }

    const sql = "INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)";
    db.query(sql, [req.session.user.id, "text", content], (err) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Database insert failed" });
        }
        res.status(201).json({ message: "Text post added successfully" });
    });
});

// ✅ Route to Post Image (Now Linked to User)
app.post("/post/image", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Image file is required" });

    const imageUrl = `/uploads/${req.file.filename}`;
    const sql = "INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)";
    db.query(sql, [req.session.user.id, "image", imageUrl], (err) => {
        if (err) return res.status(500).json({ error: err });
        res.status(201).json({ message: "Image post added successfully", url: imageUrl });
    });
});

// ✅ Route to Get Posts (Only From Users You Follow)
app.get("/posts", requireAuth, (req, res) => {
    const sql = `
        SELECT posts.*, users.f_name AS username 
        FROM posts 
        JOIN users ON posts.user_id = users.id 
        WHERE posts.user_id IN (SELECT following_id FROM followers WHERE follower_id = ?)
        ORDER BY posts.created_at DESC
    `;
    db.query(sql, [req.session.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err });
        res.json(results);
    });
});

// ✅ Follow a User
app.post("/follow", requireAuth, (req, res) => {
    const { userToFollow } = req.body;
    if (!userToFollow) return res.status(400).json({ error: "User ID is required" });

    const sql = "INSERT INTO followers (follower_id, following_id) VALUES (?, ?)";
    db.query(sql, [req.session.user.id, userToFollow], (err) => {
        if (err) return res.status(500).json({ error: "Could not follow user" });
        res.json({ message: "Followed successfully" });
    });
});

// ✅ Unfollow a User
app.post("/unfollow", requireAuth, (req, res) => {
    const { userToUnfollow } = req.body;
    if (!userToUnfollow) return res.status(400).json({ error: "User ID is required" });

    const sql = "DELETE FROM followers WHERE follower_id = ? AND following_id = ?";
    db.query(sql, [req.session.user.id, userToUnfollow], (err) => {
        if (err) return res.status(500).json({ error: "Could not unfollow user" });
        res.json({ message: "Unfollowed successfully" });
    });
});

// ✅ Get Followers Count
app.get("/followers/count", requireAuth, (req, res) => {
    const sql = "SELECT COUNT(*) AS count FROM followers WHERE following_id = ?";
    db.query(sql, [req.session.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ followers: results[0].count });
    });
});

// ✅ Get Following Count
app.get("/following/count", requireAuth, (req, res) => {
    const sql = "SELECT COUNT(*) AS count FROM followers WHERE follower_id = ?";
    db.query(sql, [req.session.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ following: results[0].count });
    });
});

// ✅ Logout Route (Unchanged)
app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
});

// ✅ Start Server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
