# Kosmikos🌌 

Kosmikos is a modern social media platform where users can create profiles, post content, and engage with others through text, images, videos, audio, and links.

## 🚀Features

✅ User Authentication – Sign up, Login, Logout

✅ Profile Management – Edit profile, upload profile pictures, update bio

✅ Post Content – Share text, images, videos, and audio

✅ Dynamic Feed – View and engage with posts from people

✅ Search & Discovery – Find users by name

✅ Commenting & Engagement – Comment on posts and interact with others

✅ Responsive Design – Mobile-friendly, seamless user experience





## 🛠 Tech Stack

Backend 🖥️

Node.js (Express.js) – API and authentication handling

MySQL – Relational database for user data, posts, and interactions

Multer – Handles file uploads (images, videos, audio)

Express-Session – Session-based authentication

Frontend 🎨

HTML, CSS, JavaScript – Interactive and responsive UI

AJAX & Fetch API – Enables real-time content updates


## ⚙️ Running locally

1. Install dependencies: `npm install`
2. Create the database: `mysql -u root -p < schema.sql`
   - Already have the database? Run this once so hashed passwords fit:
     `ALTER TABLE users MODIFY password VARCHAR(255) NOT NULL;`
3. Copy `.env.example` to `.env` and fill in your database password and a `SESSION_SECRET`.
4. Start the server: `npm start`, then open http://localhost:5000

Passwords are stored as scrypt hashes. Accounts created before this change still
log in with their old password, which is hashed automatically on first login.
