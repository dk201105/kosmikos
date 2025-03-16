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
    res.sendFile(path.join(__dirname, "profile.html"));  // If stored in 'views' folder
});
app.get("/settings", (req, res) => res.sendFile(path.join(__dirname, "settings.html")));

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
            res.redirect('/profile'); // Ensure the redirection is correct
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
    console.log("Session Data:", req.session.user); // Debugging line

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

        console.log("User data from DB:", user); // Debugging line

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

    // Construct SQL query
    let query = "UPDATE users SET f_name = ?, bio = ?";
    let params = [f_name, bio];

    if (profilePicPath) {
        query += ", profile_picture = ?";
        params.push(profilePicPath);
    }

    query += " WHERE id = ?";
    params.push(userId);

    // Execute Query
    db.query(query, params, (err) => {
        if (err) {
            console.error("Profile update failed:", err);
            return res.status(500).json({ error: "Database update failed" });
        }

        res.json({ message: "Profile updated successfully!", profilePicPath });
    });
});

async function submitPost(type) {
    let formData = new FormData();
    
    if (type === "text") {
        const content = document.getElementById("text-content").value.trim();
        if (!content) {
            alert("Text content cannot be empty.");
            return;
        }
        formData.append("content", content);
    } else if (type === "link") {
        const content = document.getElementById("link-content").value.trim();
        if (!content) {
            alert("Please provide a valid link.");
            return;
        }
        formData.append("content", content);
    } else {
        const fileInput = document.getElementById(`${type}-content`);
        if (!fileInput.files.length) {
            alert("Please upload a file.");
            return;
        }
        formData.append("file", fileInput.files[0]);
    }

    try {
        const response = await fetch(`/post/${type}`, {
            method: "POST",
            body: formData
        });

        const result = await response.json();
        if (response.ok) {
            alert("Post uploaded successfully!");
            fetchPosts();  // Refresh feed
        } else {
            alert(result.error || "Something went wrong!");
        }
    } catch (error) {
        console.error("Error posting:", error);
    }
}



// ✅ Route to Post Text (Now Linked to User)
app.post("/post/text", requireAuth, (req, res) => {
    const { content } = req.body;
    if (!content) {
        return res.status(400).json({ error: "Text content is required" });
    }

    const sql = "INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)";
    console.log("User ID:", req.session.user ? req.session.user.id : "No user session");
    db.query(sql, [req.session.user.id, "text", content], (err, result) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Database insert failed" });
        }
        console.log("Insert success:", result);  // Debugging line
        res.status(201).json({ message: "Text post added successfully" });
    });
});

// ✅ Route to Post Image (Now Linked to User)
app.post("/post/image", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Image file is required" });

    const imageUrl = `/uploads/${req.file.filename}`;
    db.query("INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)", 
        [req.session.user.id, "image", imageUrl], (err) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.status(201).json({ message: "Image post added successfully", url: imageUrl });
    });
});

// ✅ Route to Post Video (Now Linked to User)
app.post("/post/video", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Video file is required" });

    const videoUrl = `/uploads/${req.file.filename}`;
    db.query("INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)", 
        [req.session.user.id, "video", videoUrl], (err) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.status(201).json({ message: "Video post added successfully", url: videoUrl });
    });
});

// ✅ Route to Post Audio (Now Linked to User)
app.post("/post/audio", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Audio file is required" });

    const audioUrl = `/uploads/${req.file.filename}`;
    db.query("INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)", 
        [req.session.user.id, "audio", audioUrl], (err) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.status(201).json({ message: "Audio post added successfully", url: audioUrl });
    });
});

// ✅ Route to Post Link (Now Linked to User)
app.post("/post/link", requireAuth, (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "Link is required" });

    db.query("INSERT INTO posts (user_id, type, content) VALUES (?, ?, ?)", 
        [req.session.user.id, "link", content], (err) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.status(201).json({ message: "Link post added successfully" });
    });
});

// ✅ Route to Get Posts (Only From Users You Follow)
app.get("/posts", requireAuth, (req, res) => {
    const sql = `
    SELECT posts.*, users.f_name AS username 
    FROM posts 
    JOIN users ON posts.user_id = users.id 
    ORDER BY posts.created_at DESC;
    `;

    db.query(sql, [req.session.user.id], (err, results) => {
        if (err) {
            console.error("Database error fetching posts:", err);
            return res.status(500).json({ error: "Database error", details: err });
        }
        
        console.log("Posts fetched from DB:", results);  // Debugging log
        res.json(results);
    });
});

// ✅ Follow/Unfollow a User
app.post("/api/follow", requireAuth, (req, res) => {
    console.log("Request Body:", req.body);
    const { userId } = req.body; // ID of the user to follow/unfollow
    const currentUserId = req.session.user.id; // ID of the logged-in user

    console.log("Received follow request:", { userId, currentUserId }); // Debugging line

    // Validate userId
    if (!userId || isNaN(userId)) {
        console.error("Invalid user ID:", userId);
        return res.status(400).json({ error: "Invalid user ID" });
    }

    // Check if the current user is already following the target user
    const checkQuery = "SELECT * FROM followers WHERE follower_id = ? AND following_id = ?";
    db.query(checkQuery, [currentUserId, userId], (err, results) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Database error" });
        }

        if (results.length > 0) {
            // If already following, unfollow the user
            const unfollowQuery = "DELETE FROM followers WHERE follower_id = ? AND following_id = ?";
            db.query(unfollowQuery, [currentUserId, userId], (err) => {
                if (err) {
                    console.error("Database error:", err);
                    return res.status(500).json({ error: "Failed to unfollow user" });
                }
                res.json({ message: "Unfollowed successfully", isFollowing: false });
            });
        } else {
            // If not following, follow the user
            const followQuery = "INSERT INTO followers (follower_id, following_id) VALUES (?, ?)";
            db.query(followQuery, [currentUserId, userId], (err) => {
                if (err) {
                    console.error("Database error:", err);
                    return res.status(500).json({ error: "Failed to follow user" });
                }
                res.json({ message: "Followed successfully", isFollowing: true });
            });
        }
    });
});

// ✅ Get Follower Count
app.get("/api/followers/:userId", (req, res) => {
    const { userId } = req.params;

    const query = `
        SELECT 
            (SELECT COUNT(*) FROM followers WHERE following_id = ?) AS followers,
            (SELECT COUNT(*) FROM followers WHERE follower_id = ?) AS following
    `;

    db.query(query, [userId, userId], (err, results) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Failed to fetch follower count" });
        }
        res.json(results[0]);
    });
});

// ✅ Logout Route (Unchanged)
app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
});

// ✅ Signup Route (Unchanged)
app.post("/signup", (req, res) => {
    const { f_name, username, email, password, confirm_password } = req.body;

    // Validation: Check if all fields are filled
    if (!f_name || !username || !email || !password || !confirm_password) {
        return res.status(400).send('<script>alert("All fields are required!"); window.location.href="/";</script>');
    }

    // Validation: Check if passwords match
    if (password !== confirm_password) {
        return res.status(400).send('<script>alert("Passwords do not match!"); window.location.href="/";</script>');
    }

    // Insert user into MySQL database
    const sql = "INSERT INTO users (f_name, username, email, password) VALUES (?, ?, ?, ?)";
    db.query(sql, [f_name, username, email, password], (err, result) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).send('<script>alert("Database error! Try again."); window.location.href="/";</script>');
        }

        res.redirect("/login"); // Redirect to login page after successful signup
    });
});

// ✅ Start Server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));