const express = require('express');
const path = require('path');
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const nodemailer = require("nodemailer");

const app = express();
const PORT = 5000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "static")));
app.use(express.static(path.join(__dirname, "/images")));
app.use(express.static(path.join(__dirname, "/styles")));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.get("/about-us", (req, res) => {
    res.sendFile(path.join(__dirname, "about_us.html"));
});

app.get("/home", (req, res) => {
    res.sendFile(path.join(__dirname, "home.html"));
});

app.get("/profile", (req, res) => {
    res.sendFile(path.join(__dirname, "profile.html"));
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "signup.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});

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

    const CreateTableQuery = "CREATE TABLE IF NOT EXISTS users(id INT AUTO_INCREMENT PRIMARY KEY, f_name VARCHAR(255) NOT NULL, username VARCHAR(255) UNIQUE NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL)";
    
    db.query(CreateTableQuery, (err) => {
        if (err) {
            console.error("Error creating user table:", err);
            return;
        }
        console.log("User table created");
    });
});

app.post("/", (req, res) => {
    const { f_name, username, email, password, confirm_password } = req.body;

    // Check if passwords match
    if (password !== confirm_password) {
        return res.send('<script>alert("Passwords do not match"); window.location.href="/"</script>');
    }

    // Ensure a college email ID is used
    const emailRegex = /\.edu./;
    if (!emailRegex.test(email)) {
        return res.send('<script>alert("Please use a college email ID"); window.location.href="/"</script>');
    }

    // Check if username already exists
    const checkUsernameQuery = "SELECT * FROM users WHERE username = ?";
    db.query(checkUsernameQuery, [username], (err, results) => {
        if (err) {
            console.error("Error checking username:", err);
            return res.send('<script>alert("Error Checking Username"); window.location.href="/"</script>');
        }

        if (results.length > 0) {
            return res.send('<script>alert("Username already taken"); window.location.href="/"</script>');
        }

        // Insert new user into the database
        const query = "INSERT INTO users (f_name, username, email, password) VALUES (?, ?, ?, ?)";
        db.query(query, [f_name, username, email, password], (err) => {
            if (err) {
                console.error("Error signing up:", err);
                return res.send('<script>alert("Error Signing Up"); window.location.href="/"</script>');
            }

            // Send verification email
            const transporter = nodemailer.createTransport({
                service: 'Gmail',
                auth: {
                    user: "23csc11@wcc.edu.in",
                    pass: "Luckyyou1111",
                },
            });

            const mailOptions = {
                from: "23csc11@wcc.edu.in",
                to: email,
                subject: "Verify your email",
                text: "Thank you for signing up. Please verify your email by clicking the link.",
            };

            transporter.sendMail(mailOptions, (error) => {
                if (error) {
                    console.error("Error sending verification email:", error);
                    return res.send('<script>alert("Error Sending Verification Email"); window.location.href="/"</script>');
                }
                res.redirect('/home');
            });
        });
    });
});

app.post("/login", (req, res) => {
    const { email, password } = req.body;

    const query = "SELECT * FROM users WHERE email = ? AND password = ?";
    db.query(query, [email, password], (err, results) => {
        if (err) {
            console.error("Error logging in:", err);
            return res.send('<script>alert("Error Logging In"); window.location.href="/login"</script>');
        }

        if (results.length > 0) {
            res.redirect('/home');
        } else {
            res.send('<script>alert("Invalid Email ID or Password"); window.location.href="/login"</script>');
        }
    });
});

const cors = require("cors");
const multer = require("multer");

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("uploads"));

// File Storage Configuration (for images, videos, audio)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    },
});

const upload = multer({ storage: storage });

// Route: Post Text
app.post("/post/text", (req, res) => {
    console.log("Received request:", req.body); // Debug log
    const { content } = req.body;

    if (!content) {
        console.error("No text content received");
        return res.status(400).json({ error: "Text content is required" });
    }

    const sql = "INSERT INTO posts (type, content) VALUES (?, ?)";
    db.query(sql, ["text", content], (err, result) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Database insert failed" });
        }
        res.status(201).json({ message: "Text post added successfully", id: result.insertId });
    });
});

// Route: Post Image
app.post("/post/image", upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Image file is required" });

    const imageUrl = `/uploads/${req.file.filename}`;
    console.log("Uploaded image URL:", imageUrl); // Debugging

    const sql = "INSERT INTO posts (type, content) VALUES (?, ?)";
    db.query(sql, ["image", imageUrl], (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.status(201).json({ message: "Image post added successfully", id: result.insertId, url: imageUrl });
    });
});

// Route: Post Video
app.post("/post/video", upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Video file is required" });

    const videoUrl = `/uploads/${req.file.filename}`;
    const sql = "INSERT INTO posts (type, content) VALUES (?, ?)";
    db.query(sql, ["video", videoUrl], (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.status(201).json({ message: "Video post added successfully", id: result.insertId, url: videoUrl });
    });
});

// Route: Post Audio
app.post("/post/audio", upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Audio file is required" });

    const audioUrl = `/uploads/${req.file.filename}`;
    const sql = "INSERT INTO posts (type, content) VALUES (?, ?)";
    db.query(sql, ["audio", audioUrl], (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.status(201).json({ message: "Audio post added successfully", id: result.insertId, url: audioUrl });
    });
});

// Route: Post Link
app.post("/post/link", (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "Link is required" });

    const sql = "INSERT INTO posts (type, content) VALUES (?, ?)";
    db.query(sql, ["link", content], (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.status(201).json({ message: "Link post added successfully", id: result.insertId });
    });
});

// Route: Get All Posts
app.get("/posts", (req,res) => {
    const sql = "SELECT * FROM posts ORDER BY created_at DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err });
        res.json(results);
    });
});

app.listen(PORT, () => {
    console.log("Server is running on http://localhost:5000");
});
   
