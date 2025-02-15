const express = require('express');
const path = require('path');
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const nodemailer = require("nodemailer");
const session = require("express-session");

const app = express();
const PORT = 5000;

// Middleware Configuration
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "static")));
app.use(express.static(path.join(__dirname, "/images")));
app.use(express.static(path.join(__dirname, "/styles")));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session Middleware
app.use(session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
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

    const CreateTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY, 
            f_name VARCHAR(255) NOT NULL, 
            username VARCHAR(255) UNIQUE NOT NULL, 
            email VARCHAR(255) UNIQUE NOT NULL, 
            password VARCHAR(255) NOT NULL,
            bio TEXT DEFAULT NULL,
            followers INT DEFAULT 0,
            following INT DEFAULT 0,
            likes INT DEFAULT 0,
            profile_pic VARCHAR(255) DEFAULT NULL
        )`;
    
    db.query(CreateTableQuery, (err) => {
        if (err) {
            console.error("Error creating user table:", err);
            return;
        }
        console.log("User table ready");
    });
});

// ✅ **Middleware to Protect Routes**
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');  // Redirect to login if not authenticated
    }
    next();  // Continue to requested route if authenticated
};

// ✅ **Protected Home Page**
app.get("/home", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "home.html"));
});

// ✅ **Protected About Us Page**
app.get("/about-us", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "about_us.html"));
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "signup.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

// Login Route
app.post("/login", (req, res) => {
    const { email, password } = req.body;

    const query = "SELECT * FROM users WHERE email = ? AND password = ?";
    db.query(query, [email, password], (err, results) => {
        if (err) {
            console.error("Error logging in:", err);
            return res.send('<script>alert("Error Logging In"); window.location.href="/login"</script>');
        }

        if (results.length > 0) {
            req.session.user = {
                id: results[0].id,
                f_name: results[0].f_name,
                email: results[0].email
            };
            res.redirect('/profile');
        } else {
            res.send('<script>alert("Invalid Email ID or Password"); window.location.href="/login"</script>');
        }
    });
});

// ✅ **Updated: Serve Profile Page Normally**
app.get("/profile", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "profile.html"));
});

// ✅ **NEW: API to Fetch User Data**
app.get("/api/user", requireAuth, (req, res) => {
    const userId = req.session.user.id;
    db.query("SELECT f_name, bio, followers, following, likes, profile_pic FROM users WHERE id = ?", [userId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: "Database error" });
        }
        res.json(results[0]);  // Send user details as JSON
    });
});

// ✅ **NEW: API to Update User Profile**
app.post("/api/user/update", requireAuth, (req, res) => {
    const { f_name, bio, followers, following, likes } = req.body;
    const userId = req.session.user.id;

    const sql = "UPDATE users SET f_name = ?, bio = ?, followers = ?, following = ?, likes = ? WHERE id = ?";
    db.query(sql, [f_name, bio, followers, following, likes, userId], (err) => {
        if (err) {
            return res.status(500).json({ error: "Database update failed" });
        }
        res.json({ message: "Profile updated successfully!" });
    });
});

// Logout Route
app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
