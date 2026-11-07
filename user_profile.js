function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeUrl(value) {
    const url = String(value ?? "");
    if (url.startsWith("/uploads/")) return url;
    try {
        const parsed = new URL(url, window.location.origin);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    } catch (e) { /* invalid */ }
    return "#";
}

const DEFAULT_PROFILE_PIC = "/images/default_profile_pic.jpg";

async function fetchUserProfile() {
    const userId = window.location.pathname.split("/").pop();
    try {
        const response = await fetch(`/api/profile/${encodeURIComponent(userId)}`);
        const data = await response.json();

        if (data.error) {
            document.body.textContent = "User not found";
            return;
        }

        // Set Profile Header
        document.getElementById("user-name").textContent = data.user.f_name;
        document.getElementById("profile-pic").src = data.user.profile_picture ? safeUrl(data.user.profile_picture) : DEFAULT_PROFILE_PIC;
        document.getElementById("user-bio").textContent = data.user.bio || "No bio available.";

        // Display Posts
        const postsFeed = document.getElementById("posts-feed");
        postsFeed.innerHTML = data.posts.length > 0 
            ? data.posts.map(post => `
                <div class="post">
                    <div class="post-header">
                        <img src="${escapeHtml(data.user.profile_picture ? safeUrl(data.user.profile_picture) : DEFAULT_PROFILE_PIC)}" alt="Profile" class="post-avatar">
                        <span class="post-username">${escapeHtml(data.user.f_name)}</span>
                    </div>
                    <div class="post-content">
                        ${getPostContent(post)}
                    </div>
                </div>
            `).join("")
            : "<p>No posts yet.</p>";

    } catch (error) {
        console.error("Error loading profile:", error);
    }
}

function getPostContent(post) {
    const content = escapeHtml(post.content);
    const src = escapeHtml(safeUrl(post.content));
    if (post.type === "text") {
        return `<p>${content}</p>`;
    } else if (post.type === "image") {
        return `<img src="${src}" alt="Image" style="max-width:100%;">`;
    } else if (post.type === "video") {
        return `<video controls style="max-width:100%;" src="${src}"></video>`;
    } else if (post.type === "audio") {
        return `<audio controls src="${src}"></audio>`;
    } else if (post.type === "link") {
        return `<a href="${src}" target="_blank" rel="noopener noreferrer">${content}</a>`;
    }
    return "";
}

fetchUserProfile();
