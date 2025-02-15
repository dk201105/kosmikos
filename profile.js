document.addEventListener("DOMContentLoaded", async function() {
    try {
        // Fetch user data from the backend
        const response = await fetch("/api/user");
        const user = await response.json();

        if (!user || !user.f_name) {
            window.location.href = "/login";  // Redirect to login if not authenticated
            return;
        }

        // Update Profile UI
        document.getElementById("user-name").value = user.f_name;
        document.getElementById("bio").value = user.bio || "";
        document.getElementById("profile-img").src = user.profile_pic || "images/default-profile.jpg";

        // Update Greeting BELOW profile
        document.getElementById("user-greeting").innerText = `Hi, ${user.f_name}!`;

    } catch (error) {
        console.error("Error loading user data:", error);
    }

    // Save Profile Changes
    document.getElementById("save-profile-btn").addEventListener("click", async function() {
        const updatedData = {
            f_name: document.getElementById("user-name").value,
            bio: document.getElementById("bio").value
        };

        const response = await fetch("/api/user/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updatedData)
        });

        const result = await response.json();
        alert(result.message || "Profile updated successfully!");
    });
});
