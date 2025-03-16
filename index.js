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
    cookie: { secure: false }  // Ensure it's set to false in development
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
    console.log('Session user:', req.session.user);  // Log session details
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
    res.sendFile(path.join(__dirname, "profile.html"));
});
app.get("/settings", (req, res) => res.sendFile(path.join(__dirname, "settings.html")));

// ✅ Login Route
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

// ✅ Configure Multer for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");  // Ensure "uploads" folder exists
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));  // Keep original extension
    },
});

// File filter to allow only certain types
const fileFilter = (req, file, cb) => {
    const allowedTypes = ["image", "video", "audio"];
    if (allowedTypes.some(type => file.mimetype.startsWith(type))) {
        cb(null, true);
    } else {
        cb(new Error("Only images, videos, and audio files are allowed"), false);
    }
};

// Multer upload middleware
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },  // 10MB limit
    fileFilter: fileFilter
});

module.exports = upload;


// ✅ API to Fetch User Data
app.get("/api/user", requireAuth, (req, res) => {
    console.log("Session Data:", req.session.user);

    if (!req.session.user || !req.session.user.id) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    const userId = req.session.user.id;

    db.query("SELECT f_name, bio, profile_picture FROM users WHERE id = ?", [userId], (err, results) => {
        if (err || results.length === 0) {
            console.error("Failed to fetch user data:", err);
            return res.status(500).json({ error: "Failed to fetch user data" });
        }

        const user = results[0];

        console.log("User data from DB:", user);

        res.json({
            f_name: user.f_name,
            bio: user.bio || "",
            profile_picture: user.profile_picture || "/images/default-profile.jpg"
        });
    });
});

// ✅ Update User Profile
app.post("/api/user/update", requireAuth, upload.single("profile_picture"), (req, res) => {
    const { f_name, bio } = req.body;
    const userId = req.session.user.id;
    let profilePicPath = req.file ? `/uploads/${req.file.filename}` : null;

    let query = "UPDATE users SET f_name = ?, bio = ?";
    let params = [f_name, bio];

    if (profilePicPath) {
        query += ", profile_picture = ?";
        params.push(profilePicPath);
    }

    query += " WHERE id = ?";
    params.push(userId);

    db.query(query, params, (err) => {
        if (err) {
            console.error("Profile update failed:", err);
            return res.status(500).json({ error: "Database update failed" });
        }

        res.json({ message: "Profile updated successfully!", profilePicPath });
    });
});

// ✅ Routes to Post Content
app.post("/post/text", requireAuth, (req, res) => {
    const { content } = req.body;
    if (!content) {
        return res.status(400).json({ error: "Text content is required" });
    }

    const sql = "INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)";
    db.query(sql, [req.session.user.id, "text", content], (err) => {
        if (err) return res.status(500).json({ error: "Database insert failed" });
        res.status(201).json({ message: "Text post added successfully" });
    });
});

app.post("/post/image", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Image file is required" });

    const imageUrl = `/uploads/${req.file.filename}`;
    db.query("INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)", 
        [req.session.user.id, "image", imageUrl], (err) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.status(201).json({ message: "Image post added successfully", url: imageUrl });
    });
});

app.post("/post/video", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Video file is required" });

    const videoUrl = `/uploads/${req.file.filename}`;
    db.query("INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)", 
        [req.session.user.id, "video", videoUrl], (err) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.status(201).json({ message: "Video post added successfully", url: videoUrl });
    });
});

app.post("/post/audio", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Audio file is required!" });
    }

    const audioUrl = `/uploads/${req.file.filename}`;

    db.query(
        "INSERT INTO posts (user_id, type, content) VALUES (?, 'audio', ?)",
        [req.session.user.id, audioUrl],
        (err) => {
            if (err) {
                console.error("Database error:", err);
                return res.status(500).json({ error: "Failed to save audio post" });
            }
            res.status(201).json({ message: "Audio uploaded successfully!", url: audioUrl });
        }
    );
});


app.post("/post/link", requireAuth, (req, res) => {
    const { content } = req.body;

    if (!content || !/^https?:\/\//.test(content.trim())) {
        return res.status(400).json({ error: "A valid link (starting with http/https) is required!" });
    }

    const sql = "INSERT INTO posts (user_id, type, content) VALUES (?, 'link', ?)";
    
    db.query(sql, [req.session.user.id, content.trim()], (err, result) => {
        if (err) {
            console.error("Error inserting link into database:", err);
            return res.status(500).json({ error: "Database error" });
        }

        console.log("✅ Link posted successfully:", content);
        res.status(201).json({ message: "Link posted successfully!", link: content });
    });
});



// ✅ Get Posts
app.get('/posts', (req, res) => {
    const sql = `
        SELECT p.*, u.f_name, u.profile_picture 
        FROM posts p 
        JOIN users u ON p.user_id = u.id 
        ORDER BY p.created_at DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching posts:", err);
            return res.status(500).json({ error: "Failed to fetch posts" });
        }
        console.log("Query Result:", results); // Debugging
        res.json(results);
    });
});

app.get("/search/users", (req, res) => {
    const searchQuery = req.query.query;

    if (!searchQuery) {
        return res.status(400).json({ error: "Search query is required" });
    }

    const sql = `
        SELECT id, f_name, profile_picture 
        FROM users 
        WHERE f_name LIKE ? 
        LIMIT 10;
    `;

    db.query(sql, [`%${searchQuery}%`], (err, results) => {
        if (err) {
            console.error("Error searching users:", err);
            return res.status(500).json({ error: "Database error" });
        }

        res.json(results);
    });
});

app.get("/search/posts", (req, res) => {
    const searchQuery = req.query.query;

    if (!searchQuery) {
        return res.status(400).json({ error: "Search query is required" });
    }

    const sql = `
        SELECT p.id, p.user_id, p.type, p.content, p.created_at, 
               u.f_name, u.username, u.profile_picture 
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.content LIKE ? 
        ORDER BY p.created_at DESC
        LIMIT 20;
    `;

    db.query(sql, [`%${searchQuery}%`], (err, results) => {
        if (err) {
            console.error("Error searching posts:", err);
            return res.status(500).json({ error: "Database error" });
        }

        res.json(results);
    });
});

app.get("/profile/:id", async (req, res) => {
    res.sendFile(path.join(__dirname, "user_profile.html"));
});

app.get("/api/profile/:id", async (req, res) => {
    const userId = req.params.id;

    try {
        const userQuery = "SELECT id, f_name, profile_picture, bio FROM users WHERE id = ?";
        const userResult = await queryDB(userQuery, [userId]);

        if (userResult.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const user = userResult[0];

        const postsQuery = "SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC";
        const posts = await queryDB(postsQuery, [userId]);

        res.json({ user, posts });
    } catch (error) {
        console.error("Error fetching profile:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Helper function for database queries (assuming you're using MySQL)
function queryDB(sql, params) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

// ✅ Logout Route
app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
});

// ✅ Signup Route
app.post('/', (req, res) => {
    const { f_name, username, email, password, confirm_password } = req.body;

    // Check if username is provided
    if (!username) {
        return res.status(400).send('<script>alert("Username is required!"); window.location.href="/";</script>');
    }

    // Password validation
    if (password !== confirm_password) {
        return res.status(400).send('<script>alert("Passwords do not match!"); window.location.href="/";</script>');
    }

    // Insert into database
    const insertUserQuery = "INSERT INTO users (f_name, username, email, password) VALUES (?, ?, ?, ?)";
    db.query(insertUserQuery, [f_name, username, email, password], (err, result) => {
        if (err) {
            console.error("Error inserting user:", err.sqlMessage || err);
            return res.status(500).send(`<script>alert("Signup failed: ${err.sqlMessage || err}"); window.location.href="/";</script>`);
        }
        res.send('<script>alert("Signup successful!"); window.location.href="/login";</script>');
    });
});



app.post("/comments", requireAuth, (req, res) => {
    const { post_id, content } = req.body;
    const user_id = req.session.user.id;

    if (!post_id || !content) {
        return res.status(400).json({ error: "Post ID and content are required." });
    }

    const sql = "INSERT INTO comments (user_id, post_id, content) VALUES (?, ?, ?)";
    db.query(sql, [user_id, post_id, content], (err, result) => {
        if (err) return res.status(500).json({ error: "Database error", details: err });

        res.json({ message: "Comment added successfully!", comment_id: result.insertId });
    });
});


app.get("/comments/:post_id", (req, res) => {
    const { post_id } = req.params;

    const sql = `
    SELECT comments.*, users.f_name AS username, users.profile_picture 
    FROM comments
    JOIN users ON comments.user_id = users.id
    WHERE comments.post_id = ?
    ORDER BY comments.created_at ASC;
    `;

    db.query(sql, [post_id], (err, results) => {
        if (err) return res.status(500).json({ error: "Database error", details: err });

        res.json(results);
    });
});

app.delete("/comments/:id", requireAuth, (req, res) => {
    const { id } = req.params;
    const user_id = req.session.user.id;

    const sql = "DELETE FROM comments WHERE id = ? AND user_id = ?";
    db.query(sql, [id, user_id], (err, result) => {
        if (err) return res.status(500).json({ error: "Database error", details: err });

        if (result.affectedRows === 0) {
            return res.status(403).json({ error: "Unauthorized or comment not found." });
        }

        res.json({ message: "Comment deleted successfully!" });
    });
});

// ✅ Change Password Route
app.post("/api/settings/change-password", requireAuth, (req, res) => {
    const { current_password, new_password } = req.body;
    const userId = req.session.user.id;

    if (!current_password || !new_password) {
        return res.status(400).json({ error: "Current and new passwords are required." });
    }

    // Fetch the user's current password from the database
    db.query("SELECT password FROM users WHERE id = ?", [userId], (err, results) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Database error" });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const currentPasswordFromDB = results[0].password;

        // Compare the provided current password with the stored password
        if (current_password !== currentPasswordFromDB) {
            return res.status(401).json({ error: "Current password is incorrect" });
        }

        // Update the user's password in the database
        db.query("UPDATE users SET password = ? WHERE id = ?", [new_password, userId], (err) => {
            if (err) {
                console.error("Error updating password:", err);
                return res.status(500).json({ error: "Database error" });
            }

            res.json({ message: "Password updated successfully!" });
        });
    });
});

// ✅ Delete Account Route
app.post("/api/settings/delete-account", requireAuth, (req, res) => {
    const userId = req.session.user.id;

    // Delete the user from the database
    db.query("DELETE FROM users WHERE id = ?", [userId], (err) => {
        if (err) {
            console.error("Error deleting account:", err);
            return res.status(500).json({ error: "Database error" });
        }

        // Destroy the session
        req.session.destroy((err) => {
            if (err) {
                console.error("Error destroying session:", err);
                return res.status(500).json({ error: "Server error" });
            }

            res.json({ message: "Account deleted successfully!" });
        });
    });
});

// ✅ Start Server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
