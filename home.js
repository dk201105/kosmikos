function toggleForm(formId) {
    document.querySelectorAll('.post-form').forEach(form => {
        form.classList.add('hidden');
    });
    document.getElementById(formId).classList.toggle('hidden');
}

// Escape text before putting it into HTML so user content can't run scripts.
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Only allow links/media that point at our uploads or at http(s) URLs.
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

async function fetchPosts() {
    console.log("Fetching posts...");

    try {
        const response = await fetch("/posts");
        const posts = await response.json();

        console.log("Fetched posts:", posts); // Debugging log

        const feed = document.getElementById("posts-feed");
        feed.innerHTML = "";

        if (!posts.length) {
            feed.innerHTML = "<p>No posts to show.</p>";
            return;
        }

        posts.forEach(post => {
            const postElement = document.createElement("div");
            postElement.classList.add("post");

            // Create post header with profile picture & username
            const postHeader = document.createElement("div");
            postHeader.classList.add("post-header");

            // Profile picture
            const profilePic = document.createElement("img");
            profilePic.classList.add("post-avatar");
            profilePic.src = post.profile_picture && post.profile_picture !== "" 
                ? post.profile_picture 
                : DEFAULT_PROFILE_PIC; // Fallback image
            profilePic.alt = `${post.f_name || "User"}'s profile picture`;

            // Username (wrapped in link to profile)
            const username = document.createElement("a");
            username.href = `/profile/${post.user_id}`;
            username.classList.add("post-username");
            username.textContent = post.f_name || post.username;

            // Append profile pic and username
            postHeader.appendChild(profilePic);
            postHeader.appendChild(username);
            postElement.appendChild(postHeader);

            // Add post content
            const postContent = document.createElement("div");
            postContent.classList.add("post-content");

            const content = escapeHtml(post.content);
            const src = escapeHtml(safeUrl(post.content));
            if (post.type === "text") {
                postContent.innerHTML = `<p>${content}</p>`;
            } else if (post.type === "image") {
                postContent.innerHTML = `<img src="${src}" alt="Image" style="max-width:100%;">`;
            } else if (post.type === "video") {
                postContent.innerHTML = `<video controls style="max-width:100%;" src="${src}"></video>`;
            } else if (post.type === "audio") {
                postContent.innerHTML = `<audio controls src="${src}"></audio>`;
            } else if (post.type === "link") {
                postContent.innerHTML = `<a href="${src}" target="_blank" rel="noopener noreferrer">${content}</a>`;
            }

            postElement.appendChild(postContent);
            
            const commentsSection = document.createElement("div");
            commentsSection.classList.add("comments-section");
            const postId = Number(post.id);
            commentsSection.id = `comments-${postId}`;

            commentsSection.innerHTML = `
                <h4>Comments</h4>
                <div class="comments-list" id="comments-list-${postId}"></div>
                <div class="search-bar">
                    <input type="text" id="comment-input-${postId}" placeholder="Write a comment...">
                    <button data-comment-post="${postId}">Comment</button>
                </div>
            `;

            // Append comments section
            postElement.appendChild(commentsSection);
            fetchComments(postId);
            feed.appendChild(postElement);
        });

    } catch (error) {
        console.error("Error fetching posts:", error);
    }
}

function createCommentSection(postId) {
    const commentContainer = document.createElement("div");
    commentContainer.classList.add("comment-input-container");

    const commentInput = document.createElement("textarea");
    commentInput.classList.add("comment-input");
    commentInput.placeholder = "Write a comment...";

    const commentButton = document.createElement("button");
    commentButton.classList.add("comment-button");
    commentButton.innerText = "Comment";

    commentButton.addEventListener("click", () => {
        postComment(postId, commentInput.value);
        commentInput.value = ""; // Clear input after posting
    });

    commentContainer.appendChild(commentInput);
    commentContainer.appendChild(commentButton);

    return commentContainer;
}


async function fetchComments(postId) {
    try {
        const response = await fetch(`/comments/${postId}`);
        const comments = await response.json();
        const commentsList = document.getElementById(`comments-list-${postId}`);
        commentsList.innerHTML = "";

        comments.forEach(comment => {
            const commentElement = document.createElement("div");
            commentElement.classList.add("comment");
            commentElement.innerHTML = `
                <strong>${escapeHtml(comment.username)}</strong>: ${escapeHtml(comment.content)}
            `;
            commentsList.appendChild(commentElement);
        });
    } catch (error) {
        console.error("Error fetching comments:", error);
    }
}

async function submitComment(postId) {
    const commentInput = document.getElementById(`comment-input-${postId}`);
    const content = commentInput.value.trim();
    if (!content) return alert("Comment cannot be empty!");

    try {
        const response = await fetch("/comments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ post_id: postId, content })
        });
        if (response.ok) {
            commentInput.value = "";
            fetchComments(postId);
        } else {
            alert("Error posting comment.");
        }
    } catch (error) {
        console.error("Error submitting comment:", error);
    }
}

async function submitPost(type) {
    let formData = new FormData();
    const fileInput = document.getElementById(`${type}-content`);

    if (type === "text") {
        const content = fileInput.value.trim();

        if (!content) {
            alert("Text content cannot be empty!");
            return;
        }

        const response = await fetch("/post/text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content })
        });

        if (response.ok) {
            fileInput.value = ""; // Clear input
            fetchPosts();
        } else {
            alert("Error posting text.");
        }

        return;
    }

    if (!fileInput.files.length) {
        alert(`Please select a ${type} file to upload.`);
        return;
    }

    formData.append("file", fileInput.files[0]);

    const response = await fetch(`/post/${type}`, {
        method: "POST",
        body: formData,
    });

    if (response.ok) {
        fetchPosts();
    } else {
        alert("Error uploading file.");
    }
}

document.getElementById("search-input").addEventListener("input", async function () {
    const query = this.value.trim();
    const resultsContainer = document.getElementById("search-results");

    resultsContainer.innerHTML = ""; // Clear previous results

    if (query === "") {
        resultsContainer.classList.remove("active"); // Hide when empty
        return;
    }

    try {
        const response = await fetch(`/search/users?query=${encodeURIComponent(query)}`);
        const users = await response.json();

        if (users.length === 0) {
            resultsContainer.classList.remove("active"); // Hide if no results
            return;
        }

        users.forEach(user => {
            const item = document.createElement("div");
            item.classList.add("result-item");

            item.innerHTML = `
                <img src="${escapeHtml(user.profile_picture ? safeUrl(user.profile_picture) : DEFAULT_PROFILE_PIC)}" alt="Profile">
                <span>${escapeHtml(user.f_name)}</span>
            `;

            item.addEventListener("click", () => {
                window.location.href = `/profile/${encodeURIComponent(user.id)}`;
            });

            resultsContainer.appendChild(item);
        });

        resultsContainer.classList.add("active"); // Show results

    } catch (error) {
        console.error("Error fetching search results:", error);
    }
});

document.addEventListener("DOMContentLoaded", fetchPosts);

// Buttons are wired here instead of onclick="..." attributes, so the
// Content-Security-Policy can block all inline scripts.
document.querySelectorAll("[data-toggle-form]").forEach((button) => {
    button.addEventListener("click", () => toggleForm(button.dataset.toggleForm));
});
document.querySelectorAll("[data-post-type]").forEach((button) => {
    button.addEventListener("click", () => submitPost(button.dataset.postType));
});
document.getElementById("posts-feed").addEventListener("click", (event) => {
    const button = event.target.closest("[data-comment-post]");
    if (button) submitComment(Number(button.dataset.commentPost));
});
