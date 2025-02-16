document.addEventListener("DOMContentLoaded", async function() {
    try {
        const response = await fetch("/api/user");
        const user = await response.json();

        if (!user || !user.f_name) {
            window.location.href = "/login";
            return;
        }

        // Populate profile fields
        document.getElementById("user-name").value = user.f_name;
        document.getElementById("bio").value = user.bio || "";
        document.getElementById("profile-img").src = user.profile_pic || "images/default-profile.jpg";

        // Populate display section
        document.getElementById("display-user-name").innerText = user.f_name;
        document.getElementById("display-bio").innerText = user.bio || "No bio added.";
        document.getElementById("display-profile-img").src = user.profile_pic || "images/default-profile.jpg";

        // Show the correct view
        showDisplayMode();

    } catch (error) {
        console.error("Error loading user data:", error);
    }

    // Save Profile Changes
    document.getElementById("save-profile-btn").addEventListener("click", async function() {
        const formData = new FormData();
        formData.append("f_name", document.getElementById("user-name").value.trim());
        formData.append("bio", document.getElementById("bio").value.trim());

        // Check if a new file is selected
        const fileInput = document.getElementById("profile-pic-upload");
        if (fileInput.files.length > 0) {
            formData.append("profile_pic", fileInput.files[0]);
        }

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
            }

            showDisplayMode();
        } else {
            alert(result.error || "Error updating profile.");
        }
    });

    // Edit profile button
    document.getElementById("edit-profile-btn").addEventListener("click", function() {
        showEditMode();
    });

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

    // Profile Picture Preview
    document.getElementById("profile-pic-upload").addEventListener("change", function(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById("profile-img").src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
});
