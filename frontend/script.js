// Shared client-side code for login page + asset page helpers

// Auto-redirect if already logged in and on login page
(function authBootstrap() {
    const form = document.getElementById('loginForm');
    if (!form) return; // not on login page
    try {
        const u = localStorage.getItem('vosUser');
        if (u) window.location.href = 'asset-manager.html';
    } catch (_) {}
})();

(function attachLogin() {
    const form = document.getElementById('loginForm');
    if (!form) return; // not on login page

    const emailEl = document.getElementById('email');
    const passEl  = document.getElementById('password');
    const msgEl   = document.getElementById('loginMsg');

    function apiBase() {
        if (location.origin.includes(':3001')) return '';
        return 'http://localhost:3001';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msgEl.textContent = '';

        const email = emailEl.value.trim();
        const password = passEl.value;

        if (!email || !password) {
            msgEl.textContent = 'Please enter your email and password.';
            return;
        }

        try {
            const res = await fetch(`${apiBase()}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();

            if (!res.ok) {
                msgEl.textContent = data?.message || 'Login failed.';
                return;
            }

            // Persist for later use
            localStorage.setItem('userId', data.userId);

            // IMPORTANT: Persist user info for asset page and redirects
            localStorage.setItem('vosUser', JSON.stringify({
                userId: data.userId,
                email,
                fullName: data.fullName || ''
            }));

            window.location.href = 'asset-manager.html';
        } catch (err) {
            console.error(err);
            msgEl.textContent = 'Cannot reach the API server. Is it running on port 3001?';
        }
    });
})();

/* ===========================
   Asset page helpers (safe: only run if elements exist)
   =========================== */
(function assetPageEnhancements() {
    // tiny DOM helpers
    const $  = (sel, root=document) => root.querySelector(sel);

    // only proceed if we're on the asset page (classification UI present)
    const classificationSelect = $('#classificationId');
    const addClassBtn          = $('#addClassificationBtn');
    if (!classificationSelect || !addClassBtn) return;

    async function postJSON(url, body) {
        const res = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || `POST ${url} failed`);
        return data;
    }
    async function getJSON(url) {
        const res = await fetch(url);
        const data = await res.json().catch(() => ([]));
        if (!res.ok) throw new Error(`GET ${url} failed`);
        return data;
    }
    function fillSelect(selectEl, rows, {placeholder = 'Select…'} = {}) {
        if (!selectEl) return;
        const current = selectEl.value;
        selectEl.innerHTML = '';
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = placeholder;
        selectEl.appendChild(opt0);
        rows.forEach(r => {
            const o = document.createElement('option');
            o.value = r.id;
            o.textContent = r.name;
            selectEl.appendChild(o);
        });
        const stillExists = rows.some(r => String(r.id) === String(current));
        if (stillExists) selectEl.value = current;
    }

    async function loadClassifications({ selectId = null } = {}) {
        const list = await getJSON('/api/classifications'); // [{id,name},...]
        fillSelect(classificationSelect, list, { placeholder: 'Select classification…' });
        if (selectId != null) classificationSelect.value = String(selectId);
        return list;
    }

    // Initial load (does nothing if endpoint fails—just logs error)
    loadClassifications().catch(err => console.error('loadClassifications:', err));

    // Bind the "+" button
    addClassBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const name = (window.prompt('New classification name:') || '').trim();
        if (!name) return;

        try {
            const created = await postJSON('/api/classifications', { name }); // expects {id,name}
            await loadClassifications({ selectId: created.id });

            // brief highlight so user sees the selection
            classificationSelect.classList.add('ring', 'ring-emerald-400');
            setTimeout(() => classificationSelect.classList.remove('ring', 'ring-emerald-400'), 800);
        } catch (err) {
            console.error(err);
            alert(err.message || 'Failed to create classification.');
        }
    });
})();
