// --- UTILITIES ---
const peso = n => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(+n || 0);

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    container.style.zIndex = '2100'; // Ensure toast appears above all modals
    const toast = document.createElement('div');
    toast.className = 'toast p-4 rounded-lg shadow-lg text-white font-semibold';
    toast.textContent = message;
    toast.classList.add(type === 'error' ? 'bg-red-500' : 'bg-green-500');
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('show'); }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

// Compatibility helpers
function nvl(value, fallback) { return (value !== undefined && value !== null) ? value : fallback; }
function setDateInputSafe(inputEl, date) {
    try {
        if (inputEl && 'valueAsDate' in inputEl) {
            inputEl.valueAsDate = date;
        } else if (inputEl) {
            inputEl.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().split('T')[0];
        }
    } catch (_) {
        if (inputEl) inputEl.value = date.toISOString().split('T')[0];
    }
}

function getLoggedInUser() {
    try {
        const raw = localStorage.getItem('vosUser');
        if (!raw) return null;
        const u = JSON.parse(raw);
        if (!u || u.userId == null) return null;
        return u;
    } catch (_) { return null; }
}

// --- STATE ---
let items = [];
let itemTypes = [];
let classifications = [];
let departments = [];
let assets = [];
let users = [];
let editingId = null;

// --- DOM ELEMENTS ---
const bodyEl = document.getElementById('asset-body');
const statTotalEl = document.getElementById('stat-total');
const statTotalCostEl = document.getElementById('stat-total-cost');
const modalEl = document.getElementById('modal');
const formEl = document.getElementById('asset-form');
const modalTitleEl = document.getElementById('modal-title');
const drawerEl = document.getElementById('drawer');
const drawerBodyEl = document.getElementById('drawer-body');
const noResultsEl = document.getElementById('no-results');
const searchEl = document.getElementById('search');
const catFilterEl = document.getElementById('f-cat');
const deptFilterEl = document.getElementById('f-dept');
const classFilterEl = document.getElementById('f-class');
const imagePreviewEl = document.getElementById('image-preview');
const imageUploaderEl = document.getElementById('image-uploader');
const promptModalEl = document.getElementById('prompt-modal');
const promptTitleEl = document.getElementById('prompt-title');
const promptLabelEl = document.getElementById('prompt-label');
const promptInputEl = document.getElementById('prompt-input');
const promptErrorEl = document.getElementById('prompt-error');
const promptSaveBtn = document.getElementById('prompt-save');
const promptCancelBtn = document.getElementById('prompt-cancel');
let currentPromptType = null;

// --- DATA FETCHING ---
const API_BASE = window.ASSET_API_BASE || (location.port === '3001' ? '' : 'http://localhost:3001');

async function fetchAssets() {
    bodyEl.innerHTML = `<tr><td colspan="5" class="text-center py-12">Loading assets...</td></tr>`;
    try {
        const response = await fetch(`${API_BASE}/api/assets`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        assets = await response.json();
        render();
    } catch (error) {
        console.error("Could not fetch assets:", error);
        bodyEl.innerHTML = `<tr><td colspan="5" class="text-center py-12 text-red-600">Failed to load assets. ${error.message}</td></tr>`;
    }
}

async function loadItems() {
    try {
        const response = await fetch(`${API_BASE}/api/items?source=both`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        items = await response.json();
    } catch (error) { console.error("Could not fetch items:", error); items = []; }
}

async function loadItemTypes() {
    try {
        const response = await fetch(`${API_BASE}/api/item-types`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        itemTypes = await response.json();
    } catch (error) { console.error("Could not fetch item types:", error); itemTypes = []; }
}

async function loadDepartments() {
    try {
        const response = await fetch(`${API_BASE}/api/departments`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        departments = await response.json();
    } catch (error) { console.error('Could not fetch departments:', error); departments = []; }
}

async function loadClassifications() {
    try {
        const response = await fetch(`${API_BASE}/api/classifications`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        classifications = await response.json();
    } catch (error) { console.error('Could not fetch classifications:', error); classifications = []; }
}

async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE}/api/users`);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        users = await response.json();
    } catch (error) { console.error('Could not fetch users:', error); users = []; }
}

function render() {
    const qRaw  = (nvl(searchEl.value, '')).toString().trim().toLowerCase();
    const catRaw = (nvl(catFilterEl.value, '')).toString().trim().toLowerCase();
    const deptRaw = (nvl(deptFilterEl.value, '')).toString().trim().toLowerCase();
    const classRaw = (nvl(classFilterEl.value, '')).toString().trim().toLowerCase();

    const filtered = assets.filter(a => {
        const itemName  = (nvl(a.itemName, '')).toString();
        const typeName  = (nvl(a.itemTypeName, '')).toString();
        const className = (nvl(a.itemClassificationName, '')).toString();
        const deptName  = (nvl(a.departmentName, '')).toString();
        const employee  = (nvl(a.employeeName, '')).toString();

        const haystack = [a.id, itemName, typeName, className, deptName, employee]
            .map(x => (nvl(x, '')).toString().toLowerCase());
        const matchesQuery = !qRaw || haystack.some(s => s.includes(qRaw));

        const matchesType  = !catRaw   || catRaw   === 'all' || typeName.toLowerCase()  === catRaw;
        const matchesDept  = !deptRaw  || deptRaw  === 'all' || deptName.toLowerCase()  === deptRaw;
        const matchesClass = !classRaw || classRaw === 'all' || className.toLowerCase() === classRaw;

        return matchesQuery && matchesType && matchesDept && matchesClass;
    });

    bodyEl.innerHTML = filtered.length ? filtered.map(a => `
      <tr class="border-b last:border-0">
        <td class="px-6 py-4 font-medium text-slate-800">
          <a href="#" class="text-[var(--vos-primary)] hover:underline"
             onclick="event.preventDefault(); openDrawer('${a.id}')">${nvl(a.itemName, '—')}</a>
        </td>
        <td class="px-6 py-4">${nvl(a.itemTypeName, '—')}</td>
        <td class="px-6 py-4">${nvl(a.itemClassificationName, '—')}</td>
        <td class="px-6 py-4">${nvl(a.departmentName, '—')}</td>
        <td class="px-6 py-4">${a.dateAcquired ? new Date(a.dateAcquired).toLocaleDateString() : '—'}</td>
      </tr>
    `).join('') : '';

    noResultsEl.style.display = filtered.length === 0 && assets.length > 0 ? 'block' : 'none';
    statTotalEl.textContent = filtered.reduce((sum, a) => sum + (a.quantity || 0), 0);
    statTotalCostEl.textContent = peso(filtered.reduce((s, a) => s + (a.total || 0), 0));
}

const debounce = (fn, ms = 150) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
searchEl.addEventListener('input', debounce(render, 150));
catFilterEl.addEventListener('change', render);
deptFilterEl.addEventListener('change', render);
classFilterEl.addEventListener('change', render);

function populateDynamicFilters() {
    const itemOptions = items.map(i => `<option value="${i.id}">${i.itemName}</option>`).join('');
    formEl.elements.itemId.innerHTML = '<option value="">Select Item...</option>' + itemOptions;

    const typeOptions = itemTypes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    catFilterEl.innerHTML = '<option value="all">All Item Types</option>' + itemTypes.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
    formEl.elements.itemTypeId.innerHTML = '<option value="">Select...</option>' + typeOptions;

    const deptOptions = departments.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    deptFilterEl.innerHTML = '<option value="all">All Departments</option>' + departments.map(d => `<option value="${d.name}">${d.name}</option>`).join('');
    formEl.elements.departmentId.innerHTML = '<option value="">Select...</option>' + deptOptions;

    const classOptions = classifications.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    classFilterEl.innerHTML = '<option value="all">All Classifications</option>' + classifications.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    formEl.elements.classificationId.innerHTML = '<option value="">Select...</option>' + classOptions;

    const userOptions = users.map(u => `<option value="${u.userId}">${u.fullName}</option>`).join('');
    formEl.elements.employeeId.innerHTML = '<option value="">Select Employee...</option>' + userOptions;
    formEl.elements.encoderId.innerHTML = '<option value="">Select Encoder...</option>' + userOptions;

    catFilterEl.value = 'all';
    deptFilterEl.value = 'all';
    classFilterEl.value = 'all';
}

// --- EVENTS ---
document.getElementById('btn-new').onclick = () => {
    editingId = null;
    formEl.reset();
    imagePreviewEl.src = 'https://placehold.co/400x300/e2e8f0/475569?text=No+Image';
    formEl.elements.imageUrl.value = '';
    imageUploaderEl.value = ''; // Clear file input
    setDateInputSafe(formEl.elements.purchaseDate, new Date());
    modalTitleEl.textContent = 'New Asset';

    // Auto-fill Encoder with current logged-in user and disable
    const currentUser = getLoggedInUser();
    const encoderSelect = formEl.elements.encoderId;

    if (encoderSelect) {
        encoderSelect.disabled = false; // Ensure it's enabled by default
        if (currentUser && currentUser.userId != null) {
            // Check if the current user exists in the main 'users' list
            const userInList = users.find(u => String(u.userId) === String(currentUser.userId));
            if (userInList) {
                encoderSelect.value = String(currentUser.userId);
                encoderSelect.disabled = true;
            } else {
                // If user isn't in the list (e.g., inactive), leave dropdown enabled
                console.warn("Logged-in user not found in the list of available encoders. The dropdown will remain enabled.");
                encoderSelect.value = '';
            }
        }
    }

    modalEl.classList.add('open');
};

function openPrompt(type) {
    currentPromptType = type;
    promptTitleEl.textContent = `Add New ${type}`;
    promptLabelEl.textContent = `${type} Name`;
    promptInputEl.value = '';
    promptErrorEl.style.display = 'none';
    promptErrorEl.textContent = '';
    promptSaveBtn.disabled = false;
    promptModalEl.classList.add('open');
    setTimeout(() => { try { promptInputEl.focus(); } catch(_){} }, 0);
}
document.getElementById('btn-new-item').onclick = () => openPrompt('Item');
document.getElementById('btn-new-type').onclick = () => openPrompt('Item Type');
document.getElementById('btn-new-class').onclick = () => openPrompt('Classification');

promptCancelBtn.onclick = () => {
    if (promptSaveBtn.disabled) return;
    promptModalEl.classList.remove('open');
};

promptSaveBtn.onclick = async () => {
    if (!currentPromptType) return;
    const label = currentPromptType;
    const name = String(promptInputEl.value || '').trim();
    promptErrorEl.style.display = 'none';
    promptErrorEl.textContent = '';
    if (!name) {
        promptErrorEl.textContent = `${label} name is required.`;
        promptErrorEl.style.display = 'block';
        return;
    }

    promptSaveBtn.disabled = true;
    try {
        let endpoint, body, existingList;
        if (label === 'Item') {
            const itemTypeId = formEl.elements.itemTypeId.value;
            const classificationId = formEl.elements.classificationId.value;
            if (!itemTypeId || !classificationId) {
                throw new Error('Please select an Item Type and Classification before adding a new item.');
            }
            endpoint = 'items/base';
            body = { itemName: name, itemTypeId, classificationId };
            existingList = items;
        } else if (label === 'Item Type') {
            endpoint = 'item-types';
            body = { name };
            existingList = itemTypes;
        } else { // Classification
            endpoint = 'classifications';
            body = { name };
            existingList = classifications;
        }

        if (existingList.some(i => String(i.name || i.itemName).toLowerCase() === name.toLowerCase())) {
            throw new Error(`${label} already exists.`);
        }

        const resp = await fetch(`${API_BASE}/api/${endpoint}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ message: 'Failed to save.' }));
            throw new Error(err.message || 'Failed to save.');
        }
        const created = await resp.json();

        if (label === 'Item') {
            items.push(created);
            items.sort((a, b) => a.itemName.localeCompare(b.itemName));
            populateDynamicFilters();
            formEl.elements.itemId.value = created.id;
            formEl.elements.itemId.dispatchEvent(new Event('change')); // Trigger change to auto-fill
        } else if (label === 'Item Type') {
            itemTypes.push(created);
            populateDynamicFilters();
            formEl.elements.itemTypeId.value = created.id;
        } else { // Classification
            classifications.push(created);
            populateDynamicFilters();
            formEl.elements.classificationId.value = created.id;
        }

        promptModalEl.classList.remove('open');
        showToast(`${label} created successfully.`);
    } catch (e) {
        promptErrorEl.textContent = e.message || 'An error occurred while saving.';
        promptErrorEl.style.display = 'block';
    } finally {
        promptSaveBtn.disabled = false;
    }
};

// Auto-fill type and class when an item is selected
formEl.elements.itemId.addEventListener('change', (e) => {
    const selectedId = e.target.value;
    const selectedItem = items.find(i => i.id == selectedId);
    if (selectedItem) {
        formEl.elements.itemTypeId.value = selectedItem.itemTypeId;
        formEl.elements.classificationId.value = selectedItem.itemClassificationId;
        formEl.elements.itemName.value = selectedItem.itemName; // Populate hidden field
    } else {
        formEl.elements.itemName.value = '';
    }
});

formEl.onsubmit = async (e) => {
    e.preventDefault();
    const submitButton = formEl.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Saving...';

    try {
        // Populate hidden name fields for display purposes in the asset payload
        const selectedItemType = itemTypes.find(t => t.id == formEl.elements.itemTypeId.value);
        if (selectedItemType) formEl.elements.itemTypeName.value = selectedItemType.name;
        const selectedClass = classifications.find(c => c.id == formEl.elements.classificationId.value);
        if (selectedClass) formEl.elements.classificationName.value = selectedClass.name;
        const selectedDept = departments.find(d => d.id == formEl.elements.departmentId.value);
        if (selectedDept) formEl.elements.departmentName.value = selectedDept.name;
        const selectedEmployee = users.find(u => u.userId == formEl.elements.employeeId.value);
        if (selectedEmployee) formEl.elements.employeeName.value = selectedEmployee.fullName;
        const selectedEncoder = users.find(u => u.userId == formEl.elements.encoderId.value);
        if (selectedEncoder) formEl.elements.encoderName.value = selectedEncoder.fullName;

        const formData = new FormData(formEl);

        const encSelect = formEl.elements.encoderId;
        if (encSelect && encSelect.disabled && !formData.has('encoderId')) {
            formData.set('encoderId', encSelect.value);
        }

        const url = editingId ? `${API_BASE}/api/items/${editingId}` : `${API_BASE}/api/items`;
        const method = editingId ? 'PUT' : 'POST';

        const response = await fetch(url, { method, body: formData });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ message: 'Failed to save the asset.' }));
            throw new Error(err.message);
        }

        closeModal();
        await Promise.all([fetchAssets(), loadItems()]); // Reload items in case one was edited
        showToast(`Asset ${editingId ? 'updated' : 'created'} successfully.`);
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Save Asset';
        editingId = null;
    }
};

imageUploaderEl.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
    if (file.size > MAX_BYTES) {
        showToast('Image is too large. Max size is 20 MB.', 'error');
        e.target.value = '';
        return;
    }
    const uploadFormData = new FormData();
    uploadFormData.append('image', file);
    imagePreviewEl.src = 'https://placehold.co/200x150/e2e8f0/475569?text=Uploading...';
    imageUploaderEl.disabled = true;
    try {
        const response = await fetch(`${API_BASE}/api/upload-local`, { method: 'POST', body: uploadFormData });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Upload failed.');
        showToast('Image uploaded successfully!');
        imagePreviewEl.src = result.url;
        formEl.elements.imageUrl.value = result.url;
    } catch (error) {
        showToast(error.message, 'error');
        imagePreviewEl.src = 'https://placehold.co/400x300/e2e8f0/475569?text=No+Image';
        formEl.elements.imageUrl.value = '';
        e.target.value = '';
    } finally {
        imageUploaderEl.disabled = false;
    }
};

window.editAsset = (id) => {
    const asset = assets.find(x => x.id == id || x.itemId == id);
    if (!asset) return;

    editingId = asset.id || asset.itemId;
    closeDrawer();
    formEl.reset();
    imageUploaderEl.value = '';

    // The form now uses itemId, which corresponds to asset.itemId or asset.id
    formEl.elements.itemId.value = asset.itemId || asset.id;
    // Trigger change to auto-fill other dropdowns
    formEl.elements.itemId.dispatchEvent(new Event('change'));

    formEl.elements.departmentId.value = asset.departmentId || '';
    formEl.elements.totalCost.value = asset.costPerItem || '';
    if (asset.dateAcquired) {
        formEl.elements.purchaseDate.value = new Date(asset.dateAcquired).toISOString().split('T')[0];
    }
    formEl.elements.lifeSpan.value = asset.lifeSpan ? asset.lifeSpan / 12 : '';
    const allowedConditions = ['Good','Bad','Under Maintenance','Discontinued'];
    const currentCond = (asset.condition || '').trim();
    formEl.elements.condition.value = allowedConditions.includes(currentCond) ? currentCond : 'Good';
    formEl.elements.employeeId.value = asset.employeeId || '';
    if (formEl.elements.encoderId) formEl.elements.encoderId.disabled = false;
    formEl.elements.encoderId.value = asset.encoderId || '';
    formEl.elements.imageUrl.value = asset.itemImage || '';
    imagePreviewEl.src = asset.itemImage || 'https://placehold.co/400x300/e2e8f0/475569?text=No+Image';

    modalTitleEl.textContent = 'Edit Asset';
    modalEl.classList.add('open');
};

window.removeAsset = async (id) => {
    if (confirm(`Are you sure you want to delete asset ${id}?`)) {
        try {
            const response = await fetch(`${API_BASE}/api/items/${id}`, { method: 'DELETE' });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({ message: 'Server responded with an error.' }));
                throw new Error(errData.message);
            }
            closeDrawer();
            await fetchAssets();
            showToast('Asset deleted successfully.');
        } catch (error) {
            showToast(error.message, 'error');
        }
    }
};

window.closeModal = () => { modalEl.classList.remove('open'); editingId = null; };

window.openDrawer = (id) => {
    const a = assets.find(x => x.id == id || x.itemId == id);
    if (!a) return;

    const DetailCard = (label, value, full = false) =>
        value ? `<div class="vos-card p-3 ${full ? 'col-span-2' : ''}">
                <div class="text-xs text-slate-500">${label}</div>
                <div class="font-semibold">${value}</div>
              </div>` : '';

    drawerBodyEl.innerHTML = `
      <div class="vos-card mb-4">
        <img src="${a.itemImage || 'https://placehold.co/400x300/e2e8f0/475569?text=No+Image'}" class="w-full h-48 object-cover rounded-lg mb-4">
        <div class="text-xl font-bold">${a.itemName}</div>
        <div class="text-sm text-slate-500">ID: ${a.id || a.itemId}</div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        ${DetailCard("Item Type", a.itemTypeName)}
        ${DetailCard("Classification", a.itemClassificationName)}
        ${DetailCard("Department", a.departmentName, true)}
        ${DetailCard("Employee", a.employeeName, true)}
        ${DetailCard("Purchase Date", a.dateAcquired ? new Date(a.dateAcquired).toLocaleDateString() : 'N/A')}
        ${DetailCard("Cost", `<strong class="text-[var(--vos-accent)]">${peso(a.total)}</strong>`)}
        ${DetailCard("Life Span", a.lifeSpan ? `${a.lifeSpan / 12} years` : 'N/A')}
        ${DetailCard("Condition", a.condition)}
        ${DetailCard("Encoder ID", a.encoderId, true)}
      </div>
      <div class="mt-6 flex gap-2">
        <button class='vos-btn-primary text-white font-semibold py-2 px-4 rounded-lg w-full' onclick="editAsset('${a.id || a.itemId}')">Edit</button>
        <button class='vos-btn-danger text-white font-semibold py-2 px-4 rounded-lg w-full' onclick="removeAsset('${a.id || a.itemId}')">Delete</button>
      </div>
    `;
    drawerEl.classList.add('open');
};

window.closeDrawer = () => { drawerEl.classList.remove('open'); };

// --- INITIALIZATION ---
document.querySelectorAll('.label').forEach(el => el.classList.add('block','text-sm','font-medium','text-slate-700','mb-1'));
document.querySelectorAll('.input').forEach(el => el.classList.add('w-full','px-3','py-2','text-slate-900','border','rounded-md'));

document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([ loadItems(), loadItemTypes(), loadDepartments(), loadClassifications(), loadUsers(), fetchAssets() ]);
    populateDynamicFilters();
});
