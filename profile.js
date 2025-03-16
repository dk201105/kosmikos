document.addEventListener("DOMContentLoaded", async function () {
    try {
        const response = await fetch("/api/user");
        const user = await response.json();

        // Populate profile fields
        document.getElementById("user-name").value = user.f_name;
        document.getElementById("bio").value = user.bio || "";
        document.getElementById("profile-img").src = user.profile_picture || "images/default-profile.jpg";

        // Populate display section
        document.getElementById("display-user-name").innerText = user.f_name;
        document.getElementById("display-bio").innerText = user.bio || "No bio added.";
        document.getElementById("display-profile-img").src = user.profile_picture || "images/default-profile.jpg";
        document.getElementById("settings-btn").addEventListener("click", function() {
            window.location.href = "/settings.html"; // ✅ Navigates to the settings page
        });
        
        // Fetch followers & following count
        await updateFollowData(user.id);

        // Show the correct view
        showDisplayMode();

    } catch (error) {
        console.error("Error loading user data:", error);
    }

    // Save Profile Changes
    document.getElementById("save-profile-btn").addEventListener("click", async function () {
        const formData = new FormData();
        formData.append("f_name", document.getElementById("user-name").value.trim());
        formData.append("bio", document.getElementById("bio").value.trim());

        // Check if a new file is selected
        const fileInput = document.getElementById("profile-pic-upload");
        if (fileInput.files.length > 0) {
            formData.append("profile_picture", fileInput.files[0]);  // Ensure name matches backend
        }

        try {
            const response = await fetch("/api/user/update", {
                method: "POST",
                body: formData
            });

            const result = await response.json();

            if (response.ok) {
                alert(result.message || "Profile updated successfully!");

                // Update display section
                document.getElementById("display-user-name").innerText = formData.get("f_name");
                document.getElementById("display-bio").innerText = formData.get("bio") || "No bio added.";

                if (result.profilePicPath) {
                    document.getElementById("display-profile-img").src = result.profilePicPath;
                    document.getElementById("profile-img").src = result.profilePicPath;
                }

                showDisplayMode();
            } else {
                alert(result.error || "Error updating profile.");
            }
        } catch (error) {
            console.error("Error updating profile:", error);
        }
    });

    // Edit profile button
    document.getElementById("edit-profile-btn").addEventListener("click", function () {
        showEditMode();
    });

    // Follow/Unfollow functionality
    document.getElementById("follow-btn").addEventListener("click", async function () {
        const followBtn = document.getElementById("follow-btn");
        try {
            const response = await fetch("/api/user/follow", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: followBtn.dataset.userId })
            });

            const result = await response.json();
            if (response.ok) {
                followBtn.textContent = result.isFollowing ? "Unfollow" : "Follow";
                await updateFollowData(followBtn.dataset.userId);
            } else {
                alert(result.error || "Error updating follow status.");
            }
        } catch (error) {
            console.error("Error updating follow status:", error);
        }
    });

    // Profile Picture Preview Before Upload
    document.getElementById("profile-pic-upload").addEventListener("change", function (event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (e) {
                document.getElementById("profile-img").src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    // Function to update follower and following count
    async function updateFollowData(userId) {
        try {
            const followResponse = await fetch(`/api/user/followers?user_id=${userId}`);
            const followData = await followResponse.json();

            document.getElementById("follower-count").innerText = followData.followers || 0;
            document.getElementById("following-count").innerText = followData.following || 0;

            const followBtn = document.getElementById("follow-btn");
            followBtn.dataset.userId = userId;  // Store user ID in button for follow/unfollow actions
            followBtn.textContent = followData.isFollowing ? "Unfollow" : "Follow";

        } catch (error) {
            console.error("Error fetching follow data:", error);
        }
    }

    // Function to switch to Display Mode
    function showDisplayMode() {
        document.getElementById("profile-display").classList.remove("hidden");
        document.getElementById("profile-edit").classList.add("hidden");
    }

    // Function to switch to Edit Mode
    function showEditMode() {
        document.getElementById("profile-display").classList.add("hidden");
        document.getElementById("profile-edit").classList.remove("hidden");
    }
});
