document.addEventListener("DOMContentLoaded", () => {
    const privacyToggle = document.getElementById("privacy-toggle");
    const changePasswordBtn = document.getElementById("change-password-btn");
    const deleteAccountBtn = document.getElementById("delete-account-btn");

    // 🔹 Fetch user settings
    fetch("/api/settings")
        .then((res) => res.json())
        .then((data) => {
            privacyToggle.checked = data.is_private === 1;
        })
        .catch((err) => console.error("Error fetching settings:", err));

    // 🔹 Update Privacy Setting
    privacyToggle.addEventListener("change", () => {
        fetch("/api/settings/update-privacy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_private: privacyToggle.checked ? 1 : 0 }),
        })
            .then((res) => res.json())
            .then((data) => alert(data.message))
            .catch((err) => console.error("Error updating privacy:", err));
    });

    // 🔹 Change Password
    changePasswordBtn.addEventListener("click", () => {
        const currentPassword = document.getElementById("current-password").value;
        const newPassword = document.getElementById("new-password").value;
        const confirmPassword = document.getElementById("confirm-password").value;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return alert("Please fill in all fields.");
        }

        if (newPassword !== confirmPassword) {
            return alert("New passwords do not match!");
        }

        fetch("/api/settings/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
        })
            .then((res) => res.json())
            .then((data) => alert(data.message))
            .catch((err) => console.error("Error changing password:", err));
    });

    // 🔹 Delete Account
    deleteAccountBtn.addEventListener("click", () => {
        if (!confirm("Are you sure? This action cannot be undone!")) return;

        fetch("/api/settings/delete-account", {
            method: "POST",
        })
            .then((res) => res.json())
            .then((data) => {
                alert(data.message);
                window.location.href = "/login";
            })
            .catch((err) => console.error("Error deleting account:", err));
    });
});
