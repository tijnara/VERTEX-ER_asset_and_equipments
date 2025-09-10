// script.js
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const loginMsg = document.getElementById('loginMsg');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');

    // Determine API base: prefer same-origin when hosted on our backend (ports 3011/8080) or known hosts; otherwise honor window.__API_BASE__ or default to localhost:3011
    function resolveApiBase() {
        try {
            const u = new URL(location.href);
            const isKnownHost = (u.port === '3011' || u.port === '8080' || u.hostname === 'goatedcodoer' || u.hostname === '100.119.3.44');
            if (isKnownHost) {
                return location.origin.replace(/\/$/, '');
            }
        } catch (e) {}
        const hintedRaw = (window.__API_BASE__ || '').replace(/\/$/, '');
        try {
            if (hintedRaw) {
                const h = new URL(hintedRaw);
                const hintedKnown = (h.port === '3011' || h.port === '8080' || h.hostname === 'goatedcodoer' || h.hostname === '100.119.3.44');
                if (hintedKnown) return hintedRaw;
            }
        } catch (_) {
            if (hintedRaw && hintedRaw !== location.origin.replace(/\/$/, '')) return hintedRaw;
        }
        return 'http://100.119.3.44:8080';
    }
    const API_BASE = resolveApiBase();
    const API_URL = `${API_BASE}/api/users`;
    // Offline-safe mock users as a final fallback when backend is unavailable
    const MOCK_USERS = [
        { userId: 1, fullName: 'Admin User', email: 'admin@example.com', password: 'admin123', departmentName: 'IT', position: 'Administrator' },
        { userId: 2, fullName: 'Staff User', email: 'staff@example.com', password: 'staff123', departmentName: 'Operations', position: 'Staff' }
    ];

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        loginMsg.textContent = '';

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            loginMsg.textContent = 'Please enter both email and password.';
            return;
        }

        try {
            let response;
            let users;
            try {
                response = await fetch(API_URL);
            } catch (e) {
                response = undefined;
            }
            if (response && response.ok) {
                try { users = await response.json(); } catch { users = []; }
            } else {
                const fallbackBase = 'http://100.119.3.44:8080';
                const fallbackUrl = `${fallbackBase}/api/users`;
                if (!API_URL.startsWith(fallbackBase)) {
                    try {
                        response = await fetch(fallbackUrl);
                    } catch (e) {
                        response = undefined;
                    }
                    if (response && response.ok) {
                        try { users = await response.json(); } catch { users = []; }
                    }
                }
            }
            if (!Array.isArray(users) || users.length === 0) {
                users = MOCK_USERS;
            }

            const foundUser = users.find(u => u.email === email && u.password === password);
            if (foundUser) {
                loginMsg.textContent = 'Login successful! Redirecting...';
                loginMsg.style.color = 'green';

                localStorage.setItem('vosUser', JSON.stringify({
                    fullName: foundUser.fullName,
                    email: foundUser.email,
                    department: foundUser.departmentName,
                    position: foundUser.position
                }));
                localStorage.setItem('userId', foundUser.userId);

                setTimeout(() => { window.location.replace('asset-manager.html'); }, 800);
            } else {
                loginMsg.textContent = 'Invalid email or password. Please try again.';
                loginMsg.style.color = 'red';
            }
        } catch (error) {
            console.error('Login Error:', error);
            loginMsg.textContent = 'Could not connect to the server. Please check your connection.';
            loginMsg.style.color = 'red';
        }
    });
});
