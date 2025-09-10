/**
 * VOS Asset Manager - Frontend Logic (typeahead edition)
 * Works with asset-manager.html that uses text inputs + hidden IDs for:
 * - Item Name (itemNameInput + itemIdHidden + itemNameSuggest)
 * - Item Type (itemTypeInput + itemTypeIdHidden + itemTypeSuggest)
 * - Classification (classInput + classIdHidden + classSuggest)
 *
 * Keeps: stats, filters, drawer, datepicker, image upload, confirm/prompt modals.
 */

// Fallback to ensure modal/drawer 'close' buttons work even if the main script fails to initialize.
if (!window.App) { window.App = {}; }
if (!window.App.closeModal) {
    window.App.closeModal = function() {
        const m = document.getElementById('modal');
        if (m) m.classList.remove('open');
    };
}
if (!window.App.closeDrawer) {
    window.App.closeDrawer = function() {
        const d = document.getElementById('drawer');
        if (d) d.classList.remove('open');
    };
}

document.addEventListener('DOMContentLoaded', () => {
    // ---------- API CONFIGURATION ----------
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
        return 'http://localhost:8080';
    }
    const API_BASE_URL = `${resolveApiBase()}/api`;
    const UPLOAD_BASE = resolveApiBase(); // Use same-origin or hinted base for uploads

    let __isUploadingImage = false;

    // ---------- APPLICATION STATE ----------
    let state = {
        allAssets: [], allItems: [], allItemTypes: [],
        allClassifications: [], allDepartments: [], allUsers: [],
        editingId: null, currentPromptType: null,
        // Tracks sub-items created during a modal session for potential cleanup on cancel.
        tempCreated: { items: [], types: [], classes: [] },
        // When starting a new Asset, force creating/selecting a new Item first
        isNewItemFlowActive: false,
        existingItemMode: false
    };

    // ---------- DOM ELEMENT SELECTORS ----------
    const el = (id) => document.getElementById(id);
    const elements = {
        assetTableBody: el('asset-body'), noResultsMessage: el('no-results'),
        statTotalEl: el('stat-total'), statTotalCostEl: el('stat-total-cost'),
        searchEl: el('search'), catFilterEl: el('f-cat'), classFilterEl: el('f-class'), deptFilterEl: el('f-dept'),
        drawerEl: el('drawer'), drawerBodyEl: el('drawer-body'),
        modalEl: el('modal'), modalTitleEl: el('modal-title'), assetFormEl: el('asset-form'),
        newAssetBtn: el('btn-new'), newItemBtn: el('btn-new-item'),
        promptModalEl: el('prompt-modal'), promptTitleEl: el('prompt-title'), promptLabelEl: el('prompt-label'),
        promptInputEl: el('prompt-input'), promptErrorEl: el('prompt-error'), promptSaveBtn: el('prompt-save'),
        promptCancelBtn: el('prompt-cancel'),
        promptItemExtrasEl: el('prompt-item-extras'),
        promptTypeInputEl: el('prompt-type-input'),
        promptClassInputEl: el('prompt-class-input'),
    };

    // Typeahead inputs + hidden IDs + suggestion ULs from asset-manager.html
    const itemNameInput    = el('itemNameInput');
    const itemIdHidden     = el('itemIdHidden');
    const itemNameSuggest  = el('itemNameSuggest');
    const itemNameSelect   = el('itemNameSelect');

    const itemTypeInput    = el('itemTypeInput');
    const itemTypeIdHidden = el('itemTypeIdHidden');
    const itemTypeSuggest  = el('itemTypeSuggest');
    const itemTypeSelect   = el('itemTypeSelect');

    const classInput       = el('classInput');
    const classIdHidden    = el('classIdHidden');
    const classSuggest     = el('classSuggest');
    const classSelectEl    = el('classSelect');

    // Prompt modal typeahead elements
    const promptTypeInputEl  = elements.promptTypeInputEl;
    const promptClassInputEl = elements.promptClassInputEl;
    const promptTypeSuggestEl  = el('prompt-type-suggest');
    const promptClassSuggestEl = el('prompt-class-suggest');

    // ---------- HELPER FUNCTIONS ----------
    const peso = n => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(+n||0);
    const toArray = (json) => json ? (Array.isArray(json.content) ? json.content : (Array.isArray(json) ? json : [])) : [];
    const safeText = (v, fb='—') => (v ?? fb).toString().trim();
    const lc = s => (s ?? '').toString().trim().toLowerCase();
    const showToast = (msg, isErr=false) => {
        const c = document.getElementById('toast-container'); if (!c) return;
        const t = document.createElement('div');
        t.className = `toast p-4 rounded-lg shadow-lg text-white font-semibold ${isErr?'bg-red-500':'bg-green-500'}`;
        t.textContent = msg; c.appendChild(t);
        setTimeout(()=>t.classList.add('show'), 10);
        setTimeout(()=>{t.classList.remove('show'); t.addEventListener('transitionend', ()=>t.remove());}, 3000);
    };
    const debounce = (fn,d=250)=>{let k;return (...a)=>{clearTimeout(k);k=setTimeout(()=>fn.apply(this,a),d);}};
    const on = (n, ev, fn) => n && n.addEventListener(ev, fn);

    // Robust date helpers to avoid timezone shifts
    function parseDateFlexible(s) {
        if (!s) return null;
        const str = String(s).trim();
        const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(str);
        if (m) {
            const y = Number(m[1]);
            const mo = Number(m[2]) - 1;
            const d = Number(m[3]);
            const dt = new Date(y, mo, d); // local date
            // Validate (e.g., 2025-02-31 should not roll over)
            if (dt.getFullYear() === y && dt.getMonth() === mo && dt.getDate() === d) return dt;
            return null;
        }
        const dt = new Date(str);
        return isNaN(dt.getTime()) ? null : dt;
    }
    function toInputDate(value) {
        const d = parseDateFlexible(value);
        if (!d) return '';
        const pad = (n) => String(n).padStart(2,'0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    }
    const formatDate = (s, fb='—') => {
        if (!s) return fb;
        const d = parseDateFlexible(s);
        return !d ? fb : d.toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'});
    };

    // ---------- API WRAPPERS ----------
    const api = {
        get:  (ep) => fetch(`${API_BASE_URL}/${ep}`),
        post: (ep, data) => fetch(`${API_BASE_URL}/${ep}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),
        put:  (ep, id, d) => fetch(`${API_BASE_URL}/${ep}/${id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}),
        del:  (ep, id) => fetch(`${API_BASE_URL}/${ep}/${id}`, {method:'DELETE'}),
    };
    const itemsApi = {
        get:  () => api.get('items'),
        post: (data) => api.post('items', data),
        put:  (id, d) => api.put('items', id, d),
        del:  (id)   => api.del('items', id),
    };

    // ---------- AUTOCOMPLETE ----------
    function filterFuzzy(list, getLabel, query) {
        const needle = lc(query);
        if (!needle) return [];
        return list.filter(x => lc(getLabel(x)).includes(needle)).slice(0, 20);
    }

    function attachAutocomplete({ input, ul, getList, getLabel, onPick }) {
        let activeIndex = -1;

        async function createItemInline(name) {
            try {
                const trimmed = (name || '').trim();
                if (!trimmed) return;

                // Build body; try to link to currently entered/selected Type and Classification if available
                const body = { itemName: trimmed, item_name: trimmed };

                try {
                    if (!itemTypeIdHidden.value && itemTypeInput.value.trim()) {
                        const tid = await ensureType(itemTypeInput.value.trim());
                        itemTypeIdHidden.value = tid;
                    }
                    if (!classIdHidden.value && classInput.value.trim()) {
                        const cid = await ensureClass(classInput.value.trim());
                        classIdHidden.value = cid;
                    }
                } catch {}

                if (itemTypeIdHidden.value) body.itemTypeId = +itemTypeIdHidden.value;
                if (classIdHidden.value)    body.itemClassificationId = +classIdHidden.value;
                // also send snake_case and alt fallbacks for broader backend compatibility
                if (itemTypeIdHidden.value) { body.item_type_id = +itemTypeIdHidden.value; body.typeId = +itemTypeIdHidden.value; body.item_type = +itemTypeIdHidden.value; }
                if (classIdHidden.value)    { body.item_classification_id = +classIdHidden.value; body.classificationId = +classIdHidden.value; body.item_classification = +classIdHidden.value; }

                const res = await itemsApi.post(body);
                if (!res.ok) throw new Error(await res.text() || 'Failed to save item.');
                const createdRaw = await res.json();
                const created = { ...createdRaw, id: createdRaw.id ?? createdRaw.itemId, itemName: createdRaw.itemName ?? createdRaw.item_name };

                // If links came back empty, fix them via PUT now
                if ((!created.itemTypeId && itemTypeIdHidden.value) || (!created.itemClassificationId && classIdHidden.value)) {
                    const fixBody = {
                        itemTypeId: +itemTypeIdHidden.value, typeId: +itemTypeIdHidden.value, item_type_id: +itemTypeIdHidden.value,
                        itemClassificationId: +classIdHidden.value, classificationId: +classIdHidden.value, item_classification_id: +classIdHidden.value
                    };
                    try { await itemsApi.put(created.id, { ...created, ...fixBody }); } catch {}
                    created.itemTypeId = +itemTypeIdHidden.value;
                    created.itemClassificationId = +classIdHidden.value;
                }

                // Enrich with names from cached lookups
                const t = state.allItemTypes.find(x => x.id == created.itemTypeId);
                const c = state.allClassifications.find(x => x.id == created.itemClassificationId);
                if (!created.itemTypeName && t) created.itemTypeName = t.typeName || t.itemTypeName || t.name;
                if (!created.classificationName && c) created.classificationName = c.classificationName || c.name;

                state.allItems.push(created);
                // Fill inputs and hidden ids; also auto-fill type/class if available
                pickExistingItem(created);
                state.tempCreated.items.push(created.id);
                showToast('Item created.');
                hide();
                updateSaveEnabled();
            } catch (e) {
                showToast(e.message || 'Failed to create item.', true);
            }
        }

        function render(q) {
            const rows = filterFuzzy(getList(), getLabel, q);
            ul.innerHTML = '';
            activeIndex = -1;

            if (!rows.length) {
                const qt = (q || '').trim();
                // Only for Item Name typeahead: show a "Create item" action when no matches
                if (input === itemNameInput && qt) {
                    const li = document.createElement('li');
                    li.className = 'px-3 py-2 hover:bg-slate-100 cursor-pointer text-[var(--vos-primary)]';
                    li.textContent = `Create "${qt}" as new Item`;
                    li.addEventListener('mousedown', (e) => { e.preventDefault(); createItemInline(qt); });
                    ul.appendChild(li);
                    ul.style.display = 'block';
                } else {
                    ul.style.display = 'none';
                }
                return;
            }

            rows.forEach((row) => {
                const li = document.createElement('li');
                li.className = 'px-3 py-2 hover:bg-slate-100 cursor-pointer';
                li.textContent = getLabel(row);
                li.addEventListener('mousedown', e => { e.preventDefault(); onPick(row); hide(); });
                ul.appendChild(li);
            });
            ul.style.display = 'block';
        }
        function hide() { ul.style.display = 'none'; activeIndex = -1; }

        input.addEventListener('input', () => render(input.value));
        input.addEventListener('focus', () => render(input.value));
        input.addEventListener('blur',  () => setTimeout(hide, 120));

        input.addEventListener('keydown', (e) => {
            const items = Array.from(ul.children);
            if (!items.length) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = (activeIndex + 1) % items.length;
                items.forEach((li, idx) => li.classList.toggle('bg-slate-100', idx === activeIndex));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = (activeIndex - 1 + items.length) % items.length;
                items.forEach((li, idx) => li.classList.toggle('bg-slate-100', idx === activeIndex));
            } else if (e.key === 'Enter') {
                if (activeIndex >= 0) {
                    e.preventDefault();
                    items[activeIndex].dispatchEvent(new MouseEvent('mousedown'));
                }
            } else if (e.key === 'Escape') {
                hide();
            }
        });

        return { render, hide };
    }

    // ---------- UI RENDERING ----------
    const ui = {
        renderAssets: () => {
            const s = safeText(elements.searchEl.value, '').toLowerCase();
            const fCat = elements.catFilterEl.value, fCls = elements.classFilterEl.value, fDept = elements.deptFilterEl.value;
            const list = state.allAssets.filter(a=>{
                const m1 = !fCat  || fCat==='all'  || safeText(a.itemTypeName)===fCat;
                const m2 = !fCls  || fCls==='all'  || safeText(a.itemClassificationName)===fCls;
                const m3 = !fDept || fDept==='all' || safeText(a.departmentName)===fDept;
                const m4 = !s || [a.itemName,a.itemTypeName,a.itemClassificationName,a.departmentName,a.employeeName]
                    .some(v=>safeText(v,'').toLowerCase().includes(s));
                return m1&&m2&&m3&&m4;
            });
            elements.assetTableBody.innerHTML = list.map(a=>{
                const id = a.id || a.itemId;
                return `<tr class="hover:bg-gray-50 border-b last:border-0">
          <td class="px-6 py-4 font-medium text-slate-800">
            <a href="#" class="text-[var(--vos-primary)] hover:underline" onclick="event.preventDefault(); window.App.openDrawer('${id}')">${safeText(a.itemName)}</a>
          </td>
          <td class="px-6 py-4">${safeText(a.itemTypeName)}</td>
          <td class="px-6 py-4">${safeText(a.itemClassificationName)}</td>
          <td class="px-6 py-4">${safeText(a.departmentName)}</td>
          <td class="px-6 py-4">${formatDate(a.dateAcquired)}</td>
        </tr>`;
            }).join('');
            elements.noResultsMessage.style.display = list.length ? 'none' : 'block';
            if (elements.statTotalEl) elements.statTotalEl.textContent = list.length;
            if (elements.statTotalCostEl) {
                const total = list.reduce((sum,a)=> sum + (a.total || a.totalCost || 0), 0);
                elements.statTotalCostEl.textContent = peso(total);
            }
        },

        populateFilters: () => {
            const opts = (arr, key) => [...new Set(arr.map(a=>safeText(a[key],'')).filter(Boolean))]
                .map(v=>`<option value="${v}">${v}</option>`).join('');
            if (elements.catFilterEl)   elements.catFilterEl.innerHTML   = '<option value="all">All Item Types</option>' + opts(state.allAssets,'itemTypeName');
            if (elements.classFilterEl) elements.classFilterEl.innerHTML = '<option value="all">All Classifications</option>' + opts(state.allAssets,'itemClassificationName');
            if (elements.deptFilterEl)  elements.deptFilterEl.innerHTML  = '<option value="all">All Departments</option>' + opts(state.allAssets,'departmentName');
        },

        // Only dropdowns that remain as <select> in HTML
        populateFormDropdowns: () => {
            if (!elements.assetFormEl) return;
            const opt = (list, valKey, txtKey) => list.map(x=>`<option value="${x[valKey]}">${x[txtKey]}</option>`).join('');
            elements.assetFormEl.elements.departmentId.innerHTML = '<option value="">Select Department...</option>' + opt(state.allDepartments,'departmentId','departmentName');
            elements.assetFormEl.elements.employeeId.innerHTML   = '<option value="">Select Employee...</option>' + opt(state.allUsers,'userId','fullName');
            elements.assetFormEl.elements.encoderId.innerHTML    = '<option value="">Select Encoder...</option>' + opt(state.allUsers,'userId','fullName');
        },
    };

    // ---------- GLOBAL APP ACTIONS ----------
    window.App = {
        closeModal: async (opts = {}) => {
            const { skipTempCleanup = false } = opts;
            const isNew = !state.editingId;
            const hasTemp =
                isNew &&
                !skipTempCleanup &&
                (state.tempCreated.items.length ||
                    state.tempCreated.types.length ||
                    state.tempCreated.classes.length);

            if (hasTemp) {
                const ok = await confirmAsync('You created new sub-items. Close and discard them?', 'Discard Changes');
                if (!ok) return;

                const reqs = [
                    ...state.tempCreated.items.map(id => itemsApi.del(id)),
                    ...state.tempCreated.types.map(id => api.del('item-types', id)),
                    ...state.tempCreated.classes.map(id => api.del('item-classifications', id))
                ];
                await Promise.allSettled(reqs);

                if (state.tempCreated.items.length)
                    state.allItems = state.allItems.filter(x => !state.tempCreated.items.includes(x.id));
                if (state.tempCreated.types.length)
                    state.allItemTypes = state.allItemTypes.filter(x => !state.tempCreated.types.includes(x.id));
                if (state.tempCreated.classes.length)
                    state.allClassifications = state.allClassifications.filter(x => !state.tempCreated.classes.includes(x.id));
            }

            state.editingId = null;
            state.tempCreated = { items: [], types: [], classes: [] };
            // Safety: ensure form is enabled and flow flag cleared on close
            state.isNewItemFlowActive = false;
            try { setAssetFormDisabled(false); } catch {}

            elements.modalEl?.classList.remove('open');
        },

        openDrawer: (assetId) => {
            const a = state.allAssets.find(x => (x.id == assetId || x.itemId == assetId));
            if (!a || !elements.drawerEl) return;
            const card = (k,v,full=false)=> (v && v!=='—') ? `<div class="vos-card p-3 ${full?'sm:col-span-2':''}"><div class="text-xs text-slate-500">${k}</div><div class="font-semibold break-words">${v}</div></div>` : '';
            elements.drawerBodyEl.innerHTML = `
        <div class="vos-card p-4 mb-4">
          <img src="${a.itemImage || 'https://placehold.co/400x300/e2e8f0/475569?text=No+Image'}" class="w-full h-48 object-cover rounded-lg mb-4 bg-slate-100">
          <div class="text-xl font-bold">${safeText(a.itemName)}</div>
          <div class="text-sm text-slate-500">Asset ID: ${safeText(a.id || a.itemId)}</div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${card("Item Type", safeText(a.itemTypeName))}
          ${card("Classification", safeText(a.itemClassificationName))}
          ${card("Department", safeText(a.departmentName), true)}
          ${card("Assigned To", safeText(a.employeeName), true)}
          ${card("Purchase Date", formatDate(a.dateAcquired))}
          ${card("Cost", peso(a.total || a.totalCost))}
          ${card("Life Span (Years)", safeText(a.lifeSpan,'').replace(' months',''))}
          ${card("Condition", safeText(a.condition))}
          ${card("Encoded By", safeText(a.encoderName), true)}
        </div>
        <div class="mt-6 flex flex-col sm:flex-row gap-2">
          <button class='vos-btn-primary w-full' onclick="window.App.editAsset('${a.id || a.itemId}')">Edit</button>
          <button class='vos-btn-danger w-full' onclick="window.App.removeAsset('${a.id || a.itemId}')">Delete</button>
        </div>`;
            elements.drawerEl.classList.add('open');
        },

        closeDrawer: () => elements.drawerEl?.classList.remove('open'),

        editAsset: (assetId) => {
            const a = state.allAssets.find(x => (x.id == assetId || x.itemId == assetId));
            if (!a) return showToast('Asset not found for editing.', true);
            state.editingId = a.id;
            elements.assetFormEl.reset();
            App.closeDrawer();
            elements.modalTitleEl.textContent = 'Edit Asset';

            // Fill inputs for typeahead
            itemNameInput.value    = a.itemName || '';
            itemIdHidden.value     = a.itemId || '';

            itemTypeInput.value    = a.itemTypeName || '';
            itemTypeIdHidden.value = a.itemTypeId || '';

            classInput.value       = a.itemClassificationName || '';
            classIdHidden.value    = a.itemClassificationId || a.classificationId || '';

            const f = elements.assetFormEl;
            f.elements.departmentId.value = a.departmentId || '';
            f.elements.totalCost.value    = a.costPerItem || a.totalCost || '';
            f.elements.purchaseDate.value = toInputDate(a.dateAcquired);
            f.elements.lifeSpan.value     = a.lifeSpan || '';
            f.elements.condition.value    = a.condition || 'Good';
            f.elements.employeeId.value   = a.employeeId || '';
            f.elements.encoderId.value    = a.encoderId || '';
            f.elements.imageUrl.value     = a.itemImage || '';

            const $imgInput = document.getElementById('image-uploader');
            if ($imgInput) $imgInput.required = !a.itemImage;

            const $imagePreview = document.getElementById('image-preview');
            if ($imagePreview) $imagePreview.src = a.itemImage || 'https://placehold.co/400x300/e2e8f0/475569?text=No+Image';

            elements.modalEl.classList.add('open');
            updateSaveEnabled();
        },

        removeAsset: async (id) => {
            const ok = await confirmAsync(`Delete asset ID: ${id}? This cannot be undone.`);
            if (!ok) return;
            const r = await api.del('assets', id);
            if (!r.ok) { showToast('Delete failed', true); return; }
            showToast('Asset deleted.');
            App.closeDrawer();
            initialize(); // refresh data
        },

        openPrompt: (type) => {
            state.currentPromptType = type;
            elements.promptTitleEl.textContent = `Add New ${type}`;
            elements.promptLabelEl.textContent = `${type} Name`;
            elements.promptInputEl.value = '';
            elements.promptErrorEl.style.display = 'none';
            elements.promptSaveBtn.disabled = false;

            // Toggle extra fields for New Item
            if (type === 'Item') {
                if (elements.promptItemExtrasEl) elements.promptItemExtrasEl.style.display = '';
                if (elements.promptTypeInputEl) elements.promptTypeInputEl.value = (itemTypeInput?.value || '').trim();
                if (elements.promptClassInputEl) elements.promptClassInputEl.value = (classInput?.value || '').trim();
            } else {
                if (elements.promptItemExtrasEl) elements.promptItemExtrasEl.style.display = 'none';
                if (elements.promptTypeInputEl) elements.promptTypeInputEl.value = '';
                if (elements.promptClassInputEl) elements.promptClassInputEl.value = '';
            }

            elements.promptModalEl.classList.add('open');
            elements.promptInputEl.focus();
        },

        closePrompt: () => {
            elements.promptModalEl?.classList.remove('open');
            // If we are in the forced new-item flow, closing the prompt should also close the Asset modal
            if (state.isNewItemFlowActive) {
                try { setAssetFormDisabled(false); } catch {}
                state.isNewItemFlowActive = false;
                App.closeModal();
            }
        },
    };

    // ---------- Non-blocking confirm ----------
    const confirmAsync = (message, title = 'Confirm', opts = {}) => new Promise(resolve => {
        const modal = el('confirm-modal'), ok = el('confirm-ok'), cancel = el('confirm-cancel');
        el('confirm-title').textContent = title;
        el('confirm-message').textContent = message;
        const okText = (opts && opts.okText) ? String(opts.okText) : 'OK';
        const cancelText = (opts && opts.cancelText) ? String(opts.cancelText) : 'Cancel';
        if (ok) ok.textContent = okText;
        if (cancel) cancel.textContent = cancelText;
        modal.style.display = 'flex';
        const cleanup = () => { ok.onclick = cancel.onclick = null; modal.style.display = 'none'; };
        ok.onclick = () => { cleanup(); resolve(true); };
        cancel.onclick = () => { cleanup(); resolve(false); };
    });

    // ---------- FORM VALIDATION ----------
    const FIELD_LABELS = {
        // For typeahead, the real required fields are the hidden IDs
        itemId:'Item Name', itemTypeId:'Item Type', classificationId:'Classification',
        departmentId:'Department', totalCost:'Cost', purchaseDate:'Purchase Date',
        lifeSpan:'Life Span', condition:'Condition', employeeId:'Employee',
        encoderId:'Encoder', imageUrl:'Image'
    };

    function isValidDateYYYYMMDD(s) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
        const [y, m, d] = s.split('-').map(n => Number(n));
        const dt = new Date(y, m - 1, d);
        return dt.getFullYear() === y && (dt.getMonth() + 1) === m && dt.getDate() === d;
    }

    function markInvalid(field, invalid) {
        if (!field) return;
        field.classList.toggle('border-red-500', !!invalid);
        field.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    }

    function validateForm(show = false) {
        const f = elements.assetFormEl;
        const errs = new Set();

        // Clear prior marks
        Object.keys(FIELD_LABELS).forEach(k => markInvalid(f.elements[k], false));

        const requiredFields = ['itemId', 'itemTypeId', 'classificationId', 'departmentId', 'totalCost', 'purchaseDate', 'lifeSpan', 'condition', 'employeeId', 'encoderId', 'imageUrl'];
        requiredFields.forEach(name => {
            const field = f.elements[name];
            const v = (field?.value || '').trim();
            if (!v) errs.add(name);
        });

        const pd = (f.elements.purchaseDate.value || '').trim();
        if (pd && !isValidDateYYYYMMDD(pd)) errs.add('purchaseDate');

        const finalErrors = Array.from(errs);
        if (show && finalErrors.length) {
            const nice = finalErrors.map(n => FIELD_LABELS[n] || n).join(', ');
            showToast(`Please fill all required fields: ${nice}`, true);
            finalErrors.forEach(n => markInvalid(f.elements[n], true));
            f.querySelector('[aria-invalid="true"]')?.scrollIntoView({behavior:'smooth', block:'center'});
        }
        return { ok: finalErrors.length === 0, errs: finalErrors };
    }

    function updateSaveEnabled() {
        const btn = elements.assetFormEl.querySelector('button[type="submit"]');
        if (!btn) return;
        validateForm(false);
        btn.disabled = __isUploadingImage || state.isNewItemFlowActive || !!elements.assetFormEl.getAttribute('data-disabled');
    }

    function setAssetFormDisabled(disabled) {
        if (!elements.assetFormEl) return;
        const form = elements.assetFormEl;
        if (disabled) form.setAttribute('data-disabled', 'true'); else form.removeAttribute('data-disabled');
        const controls = form.querySelectorAll('input, select, textarea, button');
        controls.forEach(ctrl => { ctrl.disabled = !!disabled; });
        updateSaveEnabled();
    }

    // ---------- TYPEAHEAD SYNC HELPERS ----------
    function pickExistingItem(it) {
        // Fill input + hidden for item
        itemNameInput.value = it.itemName || it.name || '';
        itemIdHidden.value  = it.id || '';
        // And auto-fill type + class from the chosen item
        itemTypeInput.value    = it.itemTypeName || '';
        itemTypeIdHidden.value = it.itemTypeId || '';
        classInput.value       = it.classificationName || '';
        classIdHidden.value    = it.itemClassificationId || '';
    }

    function attachAllTypeaheads() {
        attachAutocomplete({
            input: itemNameInput,
            ul: itemNameSuggest,
            getList: () => state.allItems,
            getLabel: it => it.itemName || it.name || '',
            onPick: pickExistingItem
        });

        attachAutocomplete({
            input: itemTypeInput,
            ul: itemTypeSuggest,
            getList: () => state.allItemTypes,
            getLabel: it => it.typeName || it.itemTypeName || it.name || '',
            onPick: (it) => {
                itemTypeInput.value    = it.typeName || it.itemTypeName || it.name || '';
                itemTypeIdHidden.value = it.id || '';
            }
        });

        attachAutocomplete({
            input: classInput,
            ul: classSuggest,
            getList: () => state.allClassifications,
            getLabel: it => it.classificationName || it.name || '',
            onPick: (it) => {
                classInput.value    = it.classificationName || it.name || '';
                classIdHidden.value = it.id || '';
            }
        });

        // Clear hidden IDs when user types manually
        [itemNameInput, itemTypeInput, classInput].forEach(inp => {
            inp.addEventListener('input', () => {
                if (inp === itemNameInput)    itemIdHidden.value = '';
                if (inp === itemTypeInput)    itemTypeIdHidden.value = '';
                if (inp === classInput)       classIdHidden.value = '';
                updateSaveEnabled();
            });
        });
    }

    // Attach typeahead to Add New Item prompt modal fields
    function attachPromptTypeaheads() {
        if (promptTypeInputEl && promptTypeSuggestEl) {
            attachAutocomplete({
                input: promptTypeInputEl,
                ul: promptTypeSuggestEl,
                getList: () => state.allItemTypes,
                getLabel: it => it.typeName || it.itemTypeName || it.name || '',
                onPick: (it) => { promptTypeInputEl.value = it.typeName || it.itemTypeName || it.name || ''; }
            });
        }
        if (promptClassInputEl && promptClassSuggestEl) {
            attachAutocomplete({
                input: promptClassInputEl,
                ul: promptClassSuggestEl,
                getList: () => state.allClassifications,
                getLabel: it => it.classificationName || it.name || '',
                onPick: (it) => { promptClassInputEl.value = it.classificationName || it.name || ''; }
            });
        }
    }

    // ---------- EXISTING ITEM MODE ----------
    function setExistingItemMode(enabled){
        state.existingItemMode = !!enabled;
        const show = (el, flag) => { if (!el) return; el.style.display = flag ? '' : 'none'; };
        // Inputs (typeahead) vs Selects
        show(itemNameInput, !enabled); show(itemNameSuggest, !enabled);
        show(itemTypeInput, !enabled); show(itemTypeSuggest, !enabled);
        show(classInput, !enabled);    show(classSuggest, !enabled);

        show(itemNameSelect, enabled);
        show(itemTypeSelect, enabled);
        show(classSelectEl,  enabled);

        if (enabled){
            populateExistingSelectors();
            // Clear previous selections/ids
            itemIdHidden.value = '';
            itemTypeIdHidden.value = '';
            classIdHidden.value = '';
        }
        updateSaveEnabled();
    }

    function uniqueBy(arr, keyFn){
        const map = new Map();
        arr.forEach(it=>{
            const k = keyFn(it);
            if (!k && k !== 0) return;
            if (!map.has(k)) map.set(k, it);
        });
        return Array.from(map.values());
    }

    function optionize(list, val, label){
        return list.map(x=>`<option value="${x[val]}">${x[label]}</option>`).join('');
    }

    function populateExistingSelectors(){
        if (!itemNameSelect || !itemTypeSelect || !classSelectEl) return;
        // Use full reference lists so all existing records appear, not just those used by assets
        const items = uniqueBy(state.allItems.filter(i=>i.id!=null && (i.itemName || i.name)), i=>i.id)
            .map(i=>({ itemId:i.id, itemName:(i.itemName || i.name) }));
        const types = uniqueBy(state.allItemTypes.filter(t=>t.id!=null && (t.typeName || t.itemTypeName || t.name)), t=>t.id)
            .map(t=>({ itemTypeId:t.id, itemTypeName:(t.typeName || t.itemTypeName || t.name) }));
        const classes = uniqueBy(state.allClassifications.filter(c=>c.id!=null && (c.classificationName || c.name)), c=>c.id)
            .map(c=>({ itemClassificationId:c.id, itemClassificationName:(c.classificationName || c.name) }));

        itemNameSelect.innerHTML = '<option value="">Select Item...</option>' + optionize(items, 'itemId', 'itemName');
        itemTypeSelect.innerHTML = '<option value="">Select Item Type...</option>' + optionize(types, 'itemTypeId', 'itemTypeName');
        classSelectEl.innerHTML  = '<option value="">Select Classification...</option>' + optionize(classes, 'itemClassificationId', 'itemClassificationName');
    }

    function handleItemSelectChange(){
        const id = (itemNameSelect && itemNameSelect.value) ? Number(itemNameSelect.value) : null;
        itemIdHidden.value = id ? String(id) : '';
        if (!id) return;
        // Derive type/class from selected Item in the full items list
        const it = state.allItems.find(x => x.id == id);
        if (it){
            const tId = it.itemTypeId ?? it.typeId ?? it.item_type_id ?? it.item_type;
            const cId = it.itemClassificationId ?? it.classificationId ?? it.item_classification_id ?? it.item_classification;
            if (itemTypeSelect) itemTypeSelect.value = tId != null ? String(tId) : '';
            if (classSelectEl)  classSelectEl.value  = cId != null ? String(cId) : '';
            itemTypeIdHidden.value = tId != null ? String(tId) : '';
            classIdHidden.value    = cId != null ? String(cId) : '';
        }
        updateSaveEnabled();
    }

    function handleTypeSelectChange(){
        const id = (itemTypeSelect && itemTypeSelect.value) ? Number(itemTypeSelect.value) : null;
        itemTypeIdHidden.value = id ? String(id) : '';
        updateSaveEnabled();
    }

    function handleClassSelectChange(){
        const id = (classSelectEl && classSelectEl.value) ? Number(classSelectEl.value) : null;
        classIdHidden.value = id ? String(id) : '';
        updateSaveEnabled();
    }

    // ---------- FORM HANDLERS ----------
    const handleNewAssetClick = async () => {
        // Ask first whether to add existing item
        const yes = await confirmAsync('Add existing item?', 'New Asset', { okText:'Yes', cancelText:'No' });
        if (!yes) { App.openPrompt('Item'); return; }

        state.editingId = null;
        state.tempCreated = { items: [], types: [], classes: [] };
        elements.assetFormEl.reset();
        elements.modalTitleEl.textContent = 'New Asset';

        // Clear fields
        itemNameInput.value = ''; itemIdHidden.value = '';
        itemTypeInput.value = ''; itemTypeIdHidden.value = '';
        classInput.value    = ''; classIdHidden.value = '';
        if (itemNameSelect) itemNameSelect.value='';
        if (itemTypeSelect) itemTypeSelect.value='';
        if (classSelectEl)  classSelectEl.value='';

        el('image-preview').src = 'https://placehold.co/400x300/e2e8f0/475569?text=No+Image';
        el('image-uploader').required = true;
        el('purchaseDate').value = '';

        try {
            const uid = localStorage.getItem('userId');
            if (uid) elements.assetFormEl.elements.encoderId.value = String(uid);
        } catch (e) {}

        // Show modal in existing-item mode (dropdowns)
        setExistingItemMode(true);
        elements.modalEl.classList.add('open');
        state.isNewItemFlowActive = false;
        setAssetFormDisabled(false);
        updateSaveEnabled();
    };

    // Helper: discard temporary sub-items created during this modal session (if you close and confirm discard)
    async function discardTempCreated() {
        const reqs = [
            ...state.tempCreated.items.map(id => itemsApi.del(id)),
            ...state.tempCreated.types.map(id => api.del('item-types', id)),
            ...state.tempCreated.classes.map(id => api.del('item-classifications', id))
        ];
        await Promise.allSettled(reqs);
        if (state.tempCreated.items.length)   state.allItems = state.allItems.filter(x => !state.tempCreated.items.includes(x.id));
        if (state.tempCreated.types.length)   state.allItemTypes = state.allItemTypes.filter(x => !state.tempCreated.types.includes(x.id));
        if (state.tempCreated.classes.length) state.allClassifications = state.allClassifications.filter(x => !state.tempCreated.classes.includes(x.id));
        state.tempCreated = { items: [], types: [], classes: [] };
    }

    // --- Create-if-missing helpers (robust, always links IDs) ---

    // Accepts either a selected ID (hidden input) or a free-typed name and ensures a record exists, returning the id.
    async function ensureType(typeName) {
        let typeId = (itemTypeIdHidden.value || '').trim();
        if (typeId) return +typeId;

        // Try find by name in cache (support multiple possible API key names)
        const found = state.allItemTypes.find(
            t => (t.typeName || t.itemTypeName || t.name || '').trim().toLowerCase() === (typeName || '').trim().toLowerCase()
        );
        if (found) {
            itemTypeIdHidden.value = found.id;
            return found.id;
        }

        // Create new type
        // NOTE: Some backends use `typeName`, some `itemTypeName`. We pass both to be safe.
        const createBody = { typeName, itemTypeName: typeName };
        const createdRes = await api.post('item-types', createBody);
        if (!createdRes.ok) throw new Error('Failed to create Item Type.');
        const created = await createdRes.json();

        // Normalize
        const norm = { ...created, id: created.id ?? created.itemTypeId, typeName: created.typeName ?? created.itemTypeName ?? typeName };
        state.allItemTypes.push(norm);
        itemTypeIdHidden.value = norm.id;
        state.tempCreated.types.push(norm.id);
        return norm.id;
    }

    async function ensureClass(className) {
        let classId = (classIdHidden.value || '').trim();
        if (classId) return +classId;

        const found = state.allClassifications.find(
            c => (c.classificationName || c.name || '').trim().toLowerCase() === (className || '').trim().toLowerCase()
        );
        if (found) {
            classIdHidden.value = found.id;
            return found.id;
        }

        // Create new classification (send both common keys)
        const createBody = { classificationName: className, name: className };
        const createdRes = await api.post('item-classifications', createBody);
        if (!createdRes.ok) throw new Error('Failed to create Classification.');
        const created = await createdRes.json();

        const norm = { ...created, id: created.id ?? created.classificationId, classificationName: created.classificationName ?? created.name ?? className };
        state.allClassifications.push(norm);
        classIdHidden.value = norm.id;
        state.tempCreated.classes.push(norm.id);
        return norm.id;
    }

    // Always create the item with links; if backend ignores links on POST, do a follow-up PUT to set them.
    async function ensureItem(itemName, typeId, classId) {
        let itemId = (itemIdHidden.value || '').trim();
        if (itemId) return +itemId;

        // Always create a new Item record, even if an item with the same name exists
        const createBody = {
            itemName,
            item_name: itemName,
            itemTypeId: +typeId, typeId: +typeId, item_type_id: +typeId, item_type: +typeId,
            itemClassificationId: +classId, classificationId: +classId, item_classification_id: +classId, item_classification: +classId
        };
        const createdRes = await itemsApi.post(createBody);
        if (!createdRes.ok) throw new Error('Failed to create Item.');
        const created = await createdRes.json();

        // Normalize
        const createdNorm = {
            ...created,
            id: created.id ?? created.itemId,
            itemName: created.itemName ?? created.item_name,
            itemTypeId: created.itemTypeId ?? created.typeId ?? +typeId,
            itemClassificationId: created.itemClassificationId ?? created.classificationId ?? +classId
        };

        // If the API still returned nulls, force a PUT to attach the links
        if (!createdNorm.itemTypeId || !createdNorm.itemClassificationId) {
            try {
                const fixBody = {
                    itemTypeId: +typeId, typeId: +typeId, item_type_id: +typeId, item_type: +typeId,
                    itemClassificationId: +classId, classificationId: +classId, item_classification_id: +classId, item_classification: +classId
                };
                await itemsApi.put(createdNorm.id, { ...createdNorm, ...fixBody });
                createdNorm.itemTypeId = +typeId;
                createdNorm.itemClassificationId = +classId;
            } catch {}
        }

        // Fill human-readable names for type/class
        const t = state.allItemTypes.find(x => x.id == (+createdNorm.itemTypeId));
        const c = state.allClassifications.find(x => x.id == (+createdNorm.itemClassificationId));
        if (!createdNorm.itemTypeName && t) createdNorm.itemTypeName = t.typeName || t.itemTypeName;
        if (!createdNorm.classificationName && c) createdNorm.classificationName = c.classificationName || c.name;

        state.allItems.push(createdNorm);
        itemIdHidden.value = createdNorm.id;
        state.tempCreated.items.push(createdNorm.id);
        return createdNorm.id;
    }

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        if (__isUploadingImage) return showToast('Please wait for image upload.', true);

        const f = elements.assetFormEl;

        try {
            if (!state.existingItemMode) {
                // Typeahead mode: ensure dependent entities exist as needed
                const nameInput  = (itemNameInput.value || '').trim();
                const typeInputV = (itemTypeInput.value || '').trim();
                const classInputV= (classInput.value || '').trim();
                if (!nameInput || !typeInputV || !classInputV) {
                    showToast('Please fill Item Name, Item Type and Classification.', true);
                    return;
                }
                // 1) Ensure Type + Classification exist (may create)
                const typeId  = await ensureType(typeInputV);
                const classId = await ensureClass(classInputV);
                // 2) Ensure Item exists (may create) with links to Type + Classification
                await ensureItem(nameInput, typeId, classId);
            }

            // Now validate required IDs/fields
            if (!validateForm(true).ok) return;

            const data = Object.fromEntries(new FormData(f).entries());
            const i  = state.allItems.find(x=>x.id==data.itemId);
            const t  = state.allItemTypes.find(x=>x.id==data.itemTypeId);
            const c  = state.allClassifications.find(x=>x.id==data.classificationId);
            const dp = state.allDepartments.find(x=>x.departmentId==data.departmentId);

            // If the selected/created item has different link than chosen, keep them in sync
            if (data.itemId && i && (String(i.itemTypeId) !== data.itemTypeId || String(i.itemClassificationId) !== data.classificationId)) {
                const itemUpdatePayload = {
                    ...i,
                    itemTypeId: Number(data.itemTypeId), typeId: Number(data.itemTypeId), item_type_id: Number(data.itemTypeId), item_type: Number(data.itemTypeId),
                    itemClassificationId: Number(data.classificationId), classificationId: Number(data.classificationId), item_classification_id: Number(data.classificationId), item_classification: Number(data.classificationId)
                };
                try {
                    await itemsApi.put(data.itemId, itemUpdatePayload);
                    const idx = state.allItems.findIndex(x => x.id == data.itemId);
                    if (idx >= 0) state.allItems[idx] = { ...state.allItems[idx], ...itemUpdatePayload };
                } catch {}
            }

            const payload = {
                itemId: Number(data.itemId), itemName: i?.itemName,
                itemTypeId: Number(data.itemTypeId), itemTypeName: t?.typeName || t?.itemTypeName, typeName: t?.typeName || t?.itemTypeName,
                itemClassificationId: Number(data.classificationId), itemClassificationName: c?.classificationName, classificationName: c?.classificationName,
                departmentId: Number(data.departmentId), departmentName: dp?.departmentName,
                employeeId: Number(data.employeeId), employeeName: state.allUsers.find(u=>u.userId==data.employeeId)?.fullName,
                encoderId: Number(data.encoderId), encoderName: state.allUsers.find(u=>u.userId==data.encoderId)?.fullName,
                dateAcquired: data.purchaseDate,
                costPerItem: Number(data.totalCost), totalCost: Number(data.totalCost),
                lifeSpan: Number(data.lifeSpan), condition: data.condition,
                itemImage: data.imageUrl || null, quantity: 1
            };
            // Add broad alias keys for maximum backend/upstream compatibility
            try {
                // IDs and names
                if (payload.itemId != null) { payload.item_id = payload.itemId; payload.id = payload.itemId; payload.assetItemId = payload.itemId; payload.asset_item_id = payload.itemId; }
                if (payload.itemTypeId != null) { payload.item_type_id = payload.itemTypeId; payload.typeId = payload.itemTypeId; payload.item_type = payload.itemTypeId; }
                if (payload.itemClassificationId != null) { payload.item_classification_id = payload.itemClassificationId; payload.classificationId = payload.itemClassificationId; payload.item_classification = payload.itemClassificationId; }
                if (payload.departmentId != null) { payload.department_id = payload.departmentId; payload.deptId = payload.departmentId; payload.dept_id = payload.departmentId; }
                if (payload.employeeId != null) { payload.employee_id = payload.employeeId; payload.assignedToId = payload.employeeId; payload.assigned_to_id = payload.employeeId; }
                if (payload.encoderId != null) { payload.encoder_id = payload.encoderId; }
                if (payload.itemName) { payload.assetName = payload.itemName; payload.item_name = payload.itemName; }
                // Dates
                if (payload.dateAcquired) { payload.purchaseDate = payload.dateAcquired; payload.date_acquired = payload.dateAcquired; payload.acquiredDate = payload.dateAcquired; }
                // Costs
                if (payload.totalCost != null) { payload.total_cost = payload.totalCost; payload.costPerItem = payload.costPerItem ?? payload.totalCost; payload.cost_per_item = payload.costPerItem; payload.cost = payload.totalCost; payload.price = payload.totalCost; payload.unitCost = payload.totalCost; payload.unit_cost = payload.totalCost; }
                // Image
                if (payload.itemImage) { payload.imageUrl = payload.itemImage; payload.image_url = payload.itemImage; payload.image = payload.itemImage; payload.photoUrl = payload.itemImage; payload.photo_url = payload.itemImage; }
                // Quantity
                if (payload.quantity != null) { payload.qty = payload.quantity; payload.count = payload.quantity; }
                // LifeSpan
                if (payload.lifeSpan != null) { payload.lifespan = payload.lifeSpan; payload.life_span = payload.lifeSpan; }
                // Condition/Status
                if (payload.condition) { payload.status = payload.condition; payload.assetCondition = payload.condition; payload.asset_condition = payload.condition; }
            } catch {}

            const isEdit = !!state.editingId;
            const res = isEdit ? await api.put('assets', state.editingId, payload) : await api.post('assets', payload);
            if (!res.ok) {
                let t = '';
                try { t = await res.text(); } catch {}
                throw new Error(t || 'Asset save failed.');
            }
            showToast(isEdit ? 'Asset updated.' : 'Asset created.');

            // Ensure close doesn't discard sub-items created via typeahead create flow
            state.tempCreated = { items: [], types: [], classes: [] };
            await App.closeModal({ skipTempCleanup: true });

            await initialize();
        } catch (err) {
            showToast(err.message || 'Failed to save.', true);
        }
    };

    const handlePromptSave = async () => {
        const name = safeText(elements.promptInputEl.value, '');
        if (!name) {
            elements.promptErrorEl.textContent = 'Name is required.';
            elements.promptErrorEl.style.display = 'block';
            return;
        }
        elements.promptErrorEl.style.display = 'none';
        elements.promptSaveBtn.disabled = true;

        // Keep prompt modal working: it will set the inputs/IDs appropriately
        try {
            switch (state.currentPromptType) {
                case 'Item': {
                    const body = { itemName: name, item_name: name };

                    // Prefer values from the New Item prompt; fallback to main form inputs
                    const promptTypeName = (elements.promptTypeInputEl?.value || '').trim();
                    const promptClassName = (elements.promptClassInputEl?.value || '').trim();
                    // Enforce requirement: Item Type and Classification are required for Item creation flow
                    if (!promptTypeName || !promptClassName) {
                        elements.promptErrorEl.textContent = 'Item Type and Classification are required.';
                        elements.promptErrorEl.style.display = 'block';
                        elements.promptSaveBtn.disabled = false;
                        return;
                    }
                    const typeNamePref = promptTypeName || (itemTypeInput?.value || '').trim();
                    const classNamePref = promptClassName || (classInput?.value || '').trim();

                    // Ensure Type and Classification (create if needed) and set hidden IDs on the main form
                    try {
                        if (typeNamePref) {
                            const tid = await ensureType(typeNamePref);
                            itemTypeIdHidden.value = tid;
                        }
                        if (classNamePref) {
                            const cid = await ensureClass(classNamePref);
                            classIdHidden.value = cid;
                        }
                    } catch {}

                    if (itemTypeIdHidden.value) { body.itemTypeId = +itemTypeIdHidden.value; body.item_type_id = +itemTypeIdHidden.value; body.typeId = +itemTypeIdHidden.value; body.item_type = +itemTypeIdHidden.value; }
                    if (classIdHidden.value)    { body.itemClassificationId = +classIdHidden.value; body.item_classification_id = +classIdHidden.value; body.classificationId = +classIdHidden.value; body.item_classification = +classIdHidden.value; }

                    const res = await itemsApi.post(body);
                    if (!res.ok) throw new Error(await res.text() || 'Failed to save item.');
                    const createdRaw = await res.json();
                    const created = { ...createdRaw, id: createdRaw.id ?? createdRaw.itemId, itemName: createdRaw.itemName ?? createdRaw.item_name };

                    // If links came back empty, fix them via PUT now
                    if ((!created.itemTypeId && itemTypeIdHidden.value) || (!created.itemClassificationId && classIdHidden.value)) {
                        const fixBody = {
                            itemTypeId: +itemTypeIdHidden.value, typeId: +itemTypeIdHidden.value, item_type_id: +itemTypeIdHidden.value, item_type: +itemTypeIdHidden.value,
                            itemClassificationId: +classIdHidden.value, classificationId: +classIdHidden.value, item_classification_id: +classIdHidden.value, item_classification: +classIdHidden.value
                        };
                        try { await itemsApi.put(created.id, { ...created, ...fixBody }); } catch {}
                        created.itemTypeId = +itemTypeIdHidden.value;
                        created.itemClassificationId = +classIdHidden.value;
                    }

                    // Enrich with names from cached lookups
                    const t = state.allItemTypes.find(x => x.id == created.itemTypeId);
                    const c = state.allClassifications.find(x => x.id == created.itemClassificationId);
                    if (!created.itemTypeName && t) created.itemTypeName = t.typeName || t.itemTypeName || t.name;
                    if (!created.classificationName && c) created.classificationName = c.classificationName || c.name;

                    state.allItems.push(created);
                    pickExistingItem(created);
                    state.tempCreated.items.push(created.id);
                    // End forced new-item flow: re-enable the Asset form
                    state.isNewItemFlowActive = false;
                    try { setAssetFormDisabled(false); } catch {}

                    // Open New Asset modal pre-filled with the newly created Item
                    try {
                        elements.modalTitleEl.textContent = 'New Asset';
                        // Ensure we are in typeahead mode (not existing-item dropdowns)
                        setExistingItemMode(false);
                        // Reset some defaults for a fresh asset
                        const $imgInput = document.getElementById('image-uploader');
                        const $imgPrev  = document.getElementById('image-preview');
                        const $pd       = document.getElementById('purchaseDate');
                        if ($imgPrev) $imgPrev.src = 'https://placehold.co/400x300/e2e8f0/475569?text=No+Image';
                        if ($imgInput) $imgInput.required = true;
                        if ($pd) $pd.value = '';
                        // Set encoder to current logged in, if available
                        try {
                            const uid = localStorage.getItem('userId');
                            if (uid) elements.assetFormEl.elements.encoderId.value = String(uid);
                        } catch (e) {}
                        // Show the modal
                        elements.modalEl.classList.add('open');
                        // Focus next logical field
                        try { elements.assetFormEl?.elements?.departmentId?.focus(); } catch {}
                        updateSaveEnabled();
                    } catch {}
                    break;
                }
                case 'Item Type': {
                    const res = await api.post('item-types', { typeName: name });
                    if (!res.ok) throw new Error(await res.text() || 'Failed to save item type.');
                    const created = await res.json();
                    state.allItemTypes.push(created);
                    itemTypeInput.value    = created.typeName || created.itemTypeName || name;
                    itemTypeIdHidden.value = created.id;
                    state.tempCreated.types.push(created.id);
                    break;
                }
                case 'Classification': {
                    const res = await api.post('item-classifications', { classificationName: name });
                    if (!res.ok) throw new Error(await res.text() || 'Failed to save classification.');
                    const created = await res.json();
                    state.allClassifications.push(created);
                    classInput.value    = created.classificationName || name;
                    classIdHidden.value = created.id;
                    state.tempCreated.classes.push(created.id);
                    break;
                }
                default:
                    throw new Error('Invalid target type.');
            }

            showToast(`${state.currentPromptType} added successfully!`);
            App.closePrompt();
            updateSaveEnabled();
        } catch (e) {
            elements.promptErrorEl.textContent = e.message;
            elements.promptErrorEl.style.display = 'block';
        } finally {
            elements.promptSaveBtn.disabled = false;
        }
    };

    // ---------- IMAGE UPLOAD ----------
    async function handleImageUpload() {
        const file = el('image-uploader').files?.[0];
        if (!file) { updateSaveEnabled(); return; }
        try {
            __isUploadingImage = true; updateSaveEnabled();
            el('image-preview').src = URL.createObjectURL(file);

            const form = new FormData(); form.append('image', file);
            const res = await fetch(`${UPLOAD_BASE.replace(/\/$/, '')}/api/upload`, { method:'POST', body:form });
            if (!res.ok) throw new Error('Upload failed');
            const { url } = await res.json();

            elements.assetFormEl.elements.imageUrl.value = url;
            el('image-preview').src = url;
            showToast('Image uploaded.');
        } catch (err) {
            el('image-preview').src = 'https://placehold.co/400x300/e2e8f0/475569?text=No+Image';
            elements.assetFormEl.elements.imageUrl.value = '';
            showToast(err.message || 'Image upload failed.', true);
        } finally {
            __isUploadingImage = false; updateSaveEnabled();
        }
    }

    // ---------- DATE PICKER (Vanilla, JavaFX-friendly) ----------
    (function(){
        const inputEl = document.getElementById('purchaseDate');
        const btnEl = document.getElementById('btn-date');
        const popEl = document.getElementById('date-pop');
        if (!inputEl || !btnEl || !popEl) return;

        let viewDate = new Date();
        let selected = null;
        const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

        function pad(n){ return String(n).padStart(2,'0'); }
        function ymd(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
        function parseYMD(s){
            if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
            // Use local parsing to avoid UTC shifts
            return parseDateFlexible(s);
        }
        function sameDay(a,b){ return a && b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

        function render(){
            const today = new Date();
            const year = viewDate.getFullYear();
            const month = viewDate.getMonth();
            const first = new Date(year, month, 1);
            const start = new Date(first);
            start.setDate(first.getDate() - first.getDay()); // start from Sunday
            const root = document.createElement('div');

            // Header
            const head = document.createElement('div');
            head.className = 'dp-head';
            const btnPrev = document.createElement('button'); btnPrev.type='button'; btnPrev.className='dp-btn'; btnPrev.textContent='‹';
            const title = document.createElement('div'); title.className='dp-title'; title.textContent = `${months[month]} ${year}`;
            const btnNext = document.createElement('button'); btnNext.type='button'; btnNext.className='dp-btn'; btnNext.textContent='›';
            head.appendChild(btnPrev); head.appendChild(title); head.appendChild(btnNext);

            // Table
            const table = document.createElement('table'); table.className='dp-table';
            const thead = document.createElement('thead'); const thr = document.createElement('tr');
            weekdays.forEach(w=>{ const th=document.createElement('th'); th.textContent=w; thr.appendChild(th); });
            thead.appendChild(thr); table.appendChild(thead);
            const tbody = document.createElement('tbody');

            let d = new Date(start);
            for (let wk=0; wk<6; wk++){
                const tr = document.createElement('tr');
                for (let i=0;i<7;i++){
                    const td = document.createElement('td');
                    const a = document.createElement('button'); a.type='button'; a.className='dp-day'; a.textContent=String(d.getDate());
                    if (d.getMonth() !== month) a.classList.add('out');
                    if (sameDay(d, today)) a.classList.add('today');
                    if (selected && sameDay(d, selected)) a.classList.add('sel');
                    // Capture the current date value to avoid closure over the mutated `d`
                    const pick = new Date(d.getFullYear(), d.getMonth(), d.getDate());
                    a.addEventListener('click', ()=>{
                        selected = pick;
                        inputEl.value = ymd(selected);
                        inputEl.dispatchEvent(new Event('input', {bubbles:true}));
                        inputEl.dispatchEvent(new Event('change', {bubbles:true}));
                        hide();
                    });
                    td.appendChild(a); tr.appendChild(td); d.setDate(d.getDate()+1);
                }
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);

            btnPrev.addEventListener('click', ()=>{ viewDate = new Date(year, month-1, 1); update(); });
            btnNext.addEventListener('click', ()=>{ viewDate = new Date(year, month+1, 1); update(); });

            root.appendChild(head); root.appendChild(table);
            popEl.innerHTML = '';
            popEl.appendChild(root);
        }

        function show(){
            const p = parseYMD((inputEl.value||'').trim());
            selected = p || null;
            viewDate = p ? new Date(p.getFullYear(), p.getMonth(), 1) : new Date();
            render();
            popEl.style.display = 'block';
        }
        function hide(){ popEl.style.display='none'; }
        function toggle(){ if (popEl.style.display==='none' || !popEl.style.display) show(); else hide(); }
        function update(){ render(); }

        btnEl.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
        inputEl.addEventListener('focus', show);

        document.addEventListener('mousedown', (ev)=>{
            if (!popEl || popEl.style.display==='none') return;
            if (ev.target===popEl || popEl.contains(ev.target)) return;
            if (ev.target===inputEl || ev.target===btnEl) return;
            hide();
        });
        document.addEventListener('keydown', (ev)=>{ if (ev.key==='Escape') hide(); });

        const modal = document.getElementById('modal');
        if (modal){
            const mo = new MutationObserver(()=>{ if (!modal.classList.contains('open')) hide(); });
            mo.observe(modal, { attributes:true, attributeFilter:['class'] });
        }
    })();

    // ---------- INITIALIZATION ----------
    const initialize = async () => {
        try {
            const res = await Promise.all([
                api.get('assets'), itemsApi.get(), api.get('item-types'),
                api.get('item-classifications'), api.get('departments'), api.get('users')
            ]);
            if (res.some(r => !r.ok)) throw new Error('One or more API endpoints failed.');
            const [assets, items, types, classes, depts, users] = await Promise.all(res.map(r=>r.json()));

            // Normalize collections
            const assetsArr  = toArray(assets);
            const itemsArr   = toArray(items);
            const typesArr   = toArray(types);
            const classesArr = toArray(classes);
            const deptsArr   = toArray(depts);
            const usersArr   = toArray(users);

            // Build type and classification name lookup
            const typeNameById = {};
            typesArr.forEach(t => {
                if (!t) return;
                const tid = (t.id ?? t.itemTypeId ?? t.typeId);
                const tname = (t.typeName ?? t.itemTypeName ?? t.name);
                if (tid != null && tname) {
                    typeNameById[String(tid)] = tname;
                }
            });
            const classNameById = {};
            classesArr.forEach(c => {
                if (!c) return;
                const cid = (c.id ?? c.classificationId ?? c.itemClassificationId);
                const cname = (c.classificationName ?? c.name ?? c.class_name);
                if (cid != null && cname) {
                    classNameById[String(cid)] = cname;
                }
            });

            // Normalize items to ensure id, itemName, itemTypeId/itemTypeName, itemClassificationId, and classificationName are present
            const itemsNorm = itemsArr.map(x => {
                const id = x.id ?? x.itemId;
                const itemName = x.itemName ?? x.item_name;
                let itemTypeId = x.itemTypeId ?? x.typeId ?? x.item_type_id ?? x.item_type ?? x.itemType?.id;
                let itemTypeName = x.itemTypeName ?? x.typeName ?? x.itemType?.typeName ?? x.itemType?.itemTypeName ?? (itemTypeId != null ? typeNameById[String(itemTypeId)] : undefined);
                if ((itemTypeId == null || itemTypeId === '') && itemTypeName) {
                    const tMatch = typesArr.find(t => (t.typeName ?? t.itemTypeName ?? t.name ?? '').toString().trim().toLowerCase() === String(itemTypeName).trim().toLowerCase());
                    if (tMatch) {
                        itemTypeId = tMatch.id;
                        itemTypeName = tMatch.typeName ?? tMatch.itemTypeName ?? tMatch.name;
                    }
                }
                const itemClassificationId = x.itemClassificationId ?? x.classificationId ?? x.item_classification_id ?? x.item_classification ?? x.itemClassification?.id;
                const classificationName = x.classificationName ?? x.itemClassificationName ?? x.itemClassification?.classificationName ?? classNameById[String(itemClassificationId)];
                return { ...x, id, itemName, itemTypeId, itemTypeName, itemClassificationId, classificationName };
            });

            // Enrich assets with related names so UI always displays Item Type and Classification
            const itemById = Object.fromEntries(itemsNorm.map(it => [String(it.id), it]));
            const deptNameById = Object.fromEntries(deptsArr.map(d => [String(d.departmentId ?? d.id), d.departmentName ?? d.name]));
            const userNameById = Object.fromEntries(usersArr.map(u => [String(u.userId ?? u.id), u.fullName ?? u.name]));

            const assetsNorm = assetsArr.map(a => {
                const itemId = a.itemId ?? a.id ?? a.assetItemId;
                const item   = itemById[String(itemId)] || {};
                // Try to resolve Type/Classification from asset first, fallback to item, then lookup by id
                const itemTypeId = a.itemTypeId ?? a.typeId ?? item.itemTypeId;
                const itemTypeName = a.itemTypeName ?? a.typeName ?? item.itemTypeName ?? (itemTypeId != null ? typeNameById[String(itemTypeId)] : undefined);
                const itemClassificationId = a.itemClassificationId ?? a.classificationId ?? item.itemClassificationId;
                const itemClassificationName = a.itemClassificationName ?? a.classificationName ?? item.classificationName ?? (itemClassificationId != null ? classNameById[String(itemClassificationId)] : undefined);
                const departmentId = a.departmentId ?? a.deptId;
                const departmentName = a.departmentName ?? deptNameById[String(departmentId)];
                const employeeId = a.employeeId ?? a.assignedToId;
                const encoderId = a.encoderId;
                const employeeName = a.employeeName ?? userNameById[String(employeeId)];
                const encoderName = a.encoderName ?? userNameById[String(encoderId)];
                const itemName = a.itemName ?? item.itemName;
                return {
                    ...a,
                    itemId,
                    itemName,
                    itemTypeId,
                    itemTypeName,
                    itemClassificationId,
                    itemClassificationName,
                    departmentId,
                    departmentName,
                    employeeId,
                    employeeName,
                    encoderId,
                    encoderName
                };
            });

            state.allAssets          = assetsNorm;
            state.allItems           = itemsNorm;
            state.allItemTypes       = typesArr;
            state.allClassifications = classesArr;
            state.allDepartments     = deptsArr;
            state.allUsers           = usersArr;

            ui.populateFilters();
            ui.populateFormDropdowns();
            ui.renderAssets();

            // Wire the typeaheads once we have data
            attachAllTypeaheads();
            attachPromptTypeaheads();

            // Watch other fields to enable/disable Save
            const watchFields = [...elements.assetFormEl.querySelectorAll('input, select, textarea')];
            watchFields.forEach(f => {
                if (!f.__wired) {
                    on(f, 'input', updateSaveEnabled); on(f, 'change', updateSaveEnabled);
                    f.__wired = true;
                }
            });

        } catch (err) {
            console.error('Init failed', err);
            elements.noResultsMessage.innerHTML = `<h3 class="font-semibold text-lg text-red-600">Failed to load data</h3><p>${err.message}</p>`;
            elements.noResultsMessage.style.display = 'block';
        }
    };

    // ---------- EVENT LISTENERS ----------
    on(elements.searchEl, 'input', debounce(ui.renderAssets, 250));
    on(elements.catFilterEl, 'change', ui.renderAssets);
    on(elements.classFilterEl, 'change', ui.renderAssets);
    on(elements.deptFilterEl, 'change', ui.renderAssets);
    on(elements.newAssetBtn, 'click', handleNewAssetClick);
    // Removed per requirements: no 'New Item' beside Item Name
    // on(elements.newItemBtn, 'click', () => App.openPrompt('Item'));
    on(elements.assetFormEl, 'submit', handleFormSubmit);
    on(elements.promptSaveBtn, 'click', handlePromptSave);
    on(elements.promptCancelBtn, 'click', App.closePrompt);
    on(el('image-uploader'), 'change', handleImageUpload);

    // Wire change handlers for existing-item mode selects
    on(itemNameSelect, 'change', handleItemSelectChange);
    on(itemTypeSelect, 'change', handleTypeSelectChange);
    on(classSelectEl,  'change', handleClassSelectChange);

    // Prevent body scroll when modal open
    const observer = new MutationObserver(() => {
        const isOpen = elements.modalEl?.classList.contains('open');
        document.documentElement.style.overflow = isOpen ? 'hidden' : '';
    });
    if (elements.modalEl) observer.observe(elements.modalEl, { attributes: true, attributeFilter: ['class'] });

    initialize();
});