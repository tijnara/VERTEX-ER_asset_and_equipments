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

// --- New Asset Modal: image upload + save integration ---
(() => {
    // --- SETTINGS: update selectors to match your New Asset modal ---
    const MODAL_SEL        = '#new-asset-modal';          // container of the New Asset window
    const FILE_INPUT_SEL   = '#asset-image';              // your existing <input type="file">
    const SAVE_BUTTON_SEL  = '#save-asset-btn';           // your existing "Save" button
    const PREVIEW_IMG_SEL  = '#asset-image-preview';      // optional <img> inside the modal
    const SPINNER_SEL      = '#asset-image-spinner';      // optional spinner element

    // in-memory state for the New Asset being edited
    const state = { imageUrl: null };

    function $(sel, root = document) { return root.querySelector(sel); }

    function apiBase() {
        // If the page is served by the same Express (port 3001), return empty.
        // Otherwise, hardcode your host (e.g. 'http://192.168.0.65:3001')
        return '';
    }

    async function uploadImage(file) {
        const fd = new FormData();
        fd.append('file', file); // server expects field name "file"

        const res = await fetch(`${apiBase()}/api/assets/images/upload`, {
            method: 'POST',
            body: fd
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !data.url) {
            throw new Error(data.message || 'Image upload failed');
        }
        return data.url;
    }

    function setBusy(isBusy) {
        const btn = $(SAVE_BUTTON_SEL);
        const spin = $(SPINNER_SEL);
        if (btn) btn.disabled = isBusy;
        if (spin) spin.style.display = isBusy ? 'inline-block' : 'none';
    }

    async function onFileChosen(fileInput) {
        const file = fileInput.files?.[0];
        if (!file) return;

        try {
            setBusy(true);
            // (Optional) quick client validation
            if (!/^image\//.test(file.type)) throw new Error('Please select an image file.');
            if (file.size > 20 * 1024 * 1024) throw new Error('Image must be under 20 MB.');

            const url = await uploadImage(file);
            state.imageUrl = url;

            // optional image preview
            const img = $(PREVIEW_IMG_SEL);
            if (img) {
                img.src = url;
                img.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Image upload error:', err);
            alert(err.message || 'Image upload failed.');
            state.imageUrl = null;
        } finally {
            setBusy(false);
        }
    }

    // Integrate the URL into your existing Save flow:
    // - If you already have a submit handler, just include state.imageUrl in its payload.
    // - If not, here’s a wrapper example that augments your existing save handler.
    function augmentSavePayload(payload) {
        // your payload likely already has asset_name, asset_code, etc.
        // just inject the auto-generated image URL:
        return {
            ...payload,
            image_url: state.imageUrl || payload.image_url || null,
        };
    }

    // --- WIRING ---
    document.addEventListener('DOMContentLoaded', () => {
        const modal = $(MODAL_SEL);
        if (!modal) return; // New Asset modal not on this page

        const fileInput = $(FILE_INPUT_SEL, modal);
        if (fileInput) {
            fileInput.addEventListener('change', () => onFileChosen(fileInput));
        }

        // If you already have a save handler, keep it.
        // Example: wrap an existing click handler to inject image_url.
        const saveBtn = $(SAVE_BUTTON_SEL, modal);
        if (saveBtn && !saveBtn.dataset.enhanced) {
            saveBtn.dataset.enhanced = '1';

            // Example: intercept and forward to your existing save function
            const originalOnClick = saveBtn.onclick;
            saveBtn.onclick = async (e) => {
                // Build your existing payload (replace these with your actual field selectors)
                const payload = {
                    asset_name:  $('#asset-name', modal)?.value?.trim() || '',
                    asset_code:  $('#asset-code', modal)?.value?.trim() || '',
                    category_id: parseInt($('#asset-category', modal)?.value || '0', 10) || null,
                    // ... any other fields ...
                };

                const finalPayload = augmentSavePayload(payload);

                // If you already send the request elsewhere, call that here with finalPayload.
                // Otherwise, here’s a direct example POST to /api/assets:
                try {
                    setBusy(true);
                    const res = await fetch(`${apiBase()}/api/assets`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(finalPayload),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || data.success === false) {
                        throw new Error(data.message || 'Save failed');
                    }
                    alert('Asset saved successfully.');
                    // clear state for the next asset
                    state.imageUrl = null;
                    // if you maintain a list/table, refresh it here
                } catch (err) {
                    console.error('Save asset error:', err);
                    alert(err.message || 'Save failed.');
                } finally {
                    setBusy(false);
                }

                // If you originally had an onclick, call it last (or remove this)
                if (typeof originalOnClick === 'function') {
                    try { originalOnClick.call(saveBtn, e); } catch {}
                }
            };
        }
    });
})();

