// WebStorm/backend/server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
axios.defaults.maxBodyLength = Infinity;
axios.defaults.maxContentLength = Infinity;
const cors = require('cors');
const multer = require('multer');
const upload = multer({ limits: { fieldSize: 5 * 1024 * 1024, fields: 100 } }); // used for .none() on JSON forms
const pool = require('./db'); // mysql2/promise pool
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const DEBUG = process.env.DEBUG_PAYLOADS === '1';
const HOST = '0.0.0.0';

// ---- CORS ----
const allowedOrigins = [
    'http://localhost:3001',
    `http://192.168.0.65:${PORT}`,
    'http://localhost:63343',
    'http://127.0.0.1:63343',
    'null',
    ...((process.env.CORS_ORIGIN || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)),
];
app.use(cors({ origin: allowedOrigins }));

// ---- Body parsers ----
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

// Optional request body logger
if (DEBUG) {
    app.use((req, _res, next) => {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
                params: req.params, query: req.query, body: req.body,
            });
        }
        next();
    });
}

// ---- Serve frontend ----
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (_req, res) =>
    res.sendFile(path.join(__dirname, '../frontend/index.html'))
);

// ---------------- Local Uploads (disk) ----------------
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '');
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        cb(null, unique);
    },
});
const uploadLocal = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: (_req, file, cb) => {
        const ok = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']);
        if (!ok.has(file.mimetype)) return cb(new Error('Only image files are allowed.'));
        cb(null, true);
    },
});

// Serve uploaded files statically (so <img src> works in browser)
app.use('/uploads', express.static(UPLOAD_DIR));

// Upload endpoint: expects field name "image"
app.post('/api/upload-local', uploadLocal.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // ✨ UPDATED: Hardcoded the URL to use your PC's IP address
    const fileUrl = `http://192.168.0.65:${PORT}/uploads/${req.file.filename}`;

    return res.json({ message: 'Uploaded successfully', url: fileUrl, filename: req.file.filename });
});


// ---- External API addresses ----
const EXTERNAL_API_BASE = process.env.EXTERNAL_API_BASE || 'http://192.168.1.49:8080/api';
const USER_API_URL       = `${EXTERNAL_API_BASE}/users`;
const ITEM_CLASS_API_URL = `${EXTERNAL_API_BASE}/item-classifications`;
const ITEM_TYPE_API_URL  = `${EXTERNAL_API_BASE}/item-types`;
const DEPT_API_URL       = `${EXTERNAL_API_BASE}/departments`;
const ITEM_API_URL       = `${EXTERNAL_API_BASE}/items`;
const ASSET_API_URL      = `${EXTERNAL_API_BASE}/assets`;

// ---- Health ----
app.get('/health', (_req, res) => res.json({ ok: true }));

// ---- Helpers ----
function toInt(v, def = null) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}
function toFloat(v, def = 0) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : def;
}
function toISODate(v) {
    try { return v ? new Date(v).toISOString() : null; } catch { return null; }
}
function toIntOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
}

// ---------- Name resolvers (tiny caches) ----------
const _typeNameCache = new Map();
const _classNameCache = new Map();

async function getTypeNameById(id) {
    if (!id) return null;
    if (_typeNameCache.has(id)) return _typeNameCache.get(id);
    try {
        const r = await axios.get(`${ITEM_TYPE_API_URL}/${id}`, { timeout: 8000 });
        const name = r.data?.name ?? r.data?.typeName ?? r.data?.type?.name ?? null;
        if (name) { _typeNameCache.set(id, name); return name; }
    } catch {}
    try {
        const { data } = await axios.get(ITEM_TYPE_API_URL, { timeout: 8000 });
        const arr = Array.isArray(data) ? data : (Array.isArray(data?.content) ? data.content : []);
        const row = arr.find(t => [t?.id, t?.type_id, t?.typeId].includes(id));
        const name = row?.name ?? row?.type_name ?? row?.typeName ?? null;
        if (name) { _typeNameCache.set(id, name); return name; }
    } catch {}
    return null;
}
async function getClassificationNameById(id) {
    if (!id) return null;
    if (_classNameCache.has(id)) return _classNameCache.get(id);
    try {
        const r = await axios.get(`${ITEM_CLASS_API_URL}/${id}`, { timeout: 8000 });
        const name = r.data?.name ?? r.data?.classificationName ?? r.data?.classification?.name ?? null;
        if (name) { _classNameCache.set(id, name); return name; }
    } catch {}
    try {
        const { data } = await axios.get(ITEM_CLASS_API_URL, { timeout: 8000 });
        const arr = Array.isArray(data) ? data : (Array.isArray(data?.content) ? data.content : []);
        const row = arr.find(c => [c?.id, c?.classification_id, c?.classificationId].includes(id));
        const name = row?.name ?? row?.classification_name ?? row?.classificationName ?? null;
        if (name) { _classNameCache.set(id, name); return name; }
    } catch {}
    return null;
}

// ---------- Normalize item row ----------
function normalizeItemRow(it) {
    if (!it) return null;
    const id = it.id ?? it.item_id ?? it.itemId;
    const itemName = it.itemName ?? it.item_name ?? it.name ?? null;
    const itemTypeId = (it.itemTypeId ?? it.item_type ?? it.item_type_id ?? it.typeId ?? it.type_id);
    const itemClassificationId = (it.itemClassificationId ?? it.item_classification ?? it.item_classification_id ?? it.classificationId ?? it.classification_id);
    return { id, itemName, itemTypeId, itemClassificationId };
}

// ---------- Build asset payload ----------
function createAssetPayload(body, itemId) {
    const quantity    = toInt(body.quantity, 1) || 1;
    const cost        = toFloat(body.cost ?? body.totalCost, 0);
    const total       = +(cost * quantity).toFixed(2);
    const purchaseISO = toISODate(body.purchaseDate) || toISODate(body.dateAcquired) || null;
    const lifeYears   = toInt(body.lifeSpan ?? body.lifeSpanYears, null);
    const lifeMonths  = lifeYears != null ? lifeYears * 12 : null;

    const employeeId  = toInt(body.employeeId ?? body.employee, null);
    const encoderId   = toInt(body.encoderId  ?? body.encoder,  null);

    const imageText   = body.imageUrl ?? body.imageData ?? body.item_image ?? null;

    return {
        itemId,

        costPerItem: cost,
        cost_per_item: cost,
        total,

        dateAcquired: purchaseISO,
        date_acquired: purchaseISO,
        dateCreated: purchaseISO,
        date_created: purchaseISO,

        lifeSpan: lifeMonths,
        life_span: lifeMonths,

        condition: body.condition || null,

        employeeId,
        employee: employeeId,
        encoderId,
        encoder: encoderId,

        itemImage: imageText,
        item_image: imageText,

        quantity,
        departmentId: toInt(body.departmentId ?? body.department, null),
        itemName: body.itemName || null,

        // optional display fields
        itemTypeName: body.itemTypeName || null,
        item_type_name: body.itemTypeName || null,
        itemClassificationName: body.classificationName || null,
        item_classification_name: body.classificationName || null,
        departmentName: body.departmentName || null,
        department_name: body.departmentName || null,
        employeeName: body.employeeName || null,
        employee_name: body.employeeName || null,
    };
}

// ======================================================
//                    USERS (proxy)
// ======================================================
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }
        const { data: users } = await axios.get(USER_API_URL, { timeout: 15000 });
        const user = (users || []).find(u => u.email === email);
        if (!user) return res.status(401).json({ message: 'Invalid credentials.' });
        if (String(password) !== String(user.password)) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        return res.json({
            message: 'Login successful',
            userId: user.userId,
            fullName: user.fullName || email,
        });
    } catch (err) {
        console.error('Login error:', err?.message || err);
        return res.status(500).json({ message: 'Could not connect to user service.' });
    }
});

app.get('/api/users', async (_req, res) => {
    try {
        const { data } = await axios.get(USER_API_URL, { timeout: 15000 });
        const active = (Array.isArray(data) ? data : [])
            .filter(u => u.isActive)
            .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
        res.json(active);
    } catch (err) {
        console.error('Users error:', err?.message || err);
        res.status(500).json({ message: 'Could not connect to user service.' });
    }
});

// ======================================================
//                    ITEMS (DB + API)
// ======================================================

// --- DB helpers for items table (MySQL) ---
async function dbGetItems() {
    const sql = `SELECT id, item_name, item_type, item_classification FROM items ORDER BY item_name ASC`;
    const [rows] = await pool.query(sql);
    return rows.map(r => ({
        id: r.id,
        itemName: r.item_name,
        itemTypeId: r.item_type,
        itemClassificationId: r.item_classification,
    }));
}
async function dbUpsertItem(id, itemName, itemTypeId, classificationId) {
    const sql = `
        INSERT INTO items (id, item_name, item_type, item_classification)
        VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                                 item_name = VALUES(item_name),
                                 item_type = VALUES(item_type),
                                 item_classification = VALUES(item_classification)
    `;
    await pool.query(sql, [id, itemName, itemTypeId, classificationId]);
}
async function dbUpdateItem(id, itemName, itemTypeId, classificationId) {
    const sql = `UPDATE items SET item_name=?, item_type=?, item_classification=? WHERE id=?`;
    await pool.query(sql, [itemName, itemTypeId, classificationId, id]);
}
async function dbDeleteItem(id) {
    const sql = `DELETE FROM items WHERE id=?`;
    await pool.query(sql, [id]);
}

// GET /api/items
// - source=db (default): fetch from MySQL
// - source=api: proxy external API
// - source=both: merge db + api (unique by id)
app.get('/api/items', async (req, res) => {
    const source = (req.query.source || 'db').toLowerCase();
    try {
        if (source === 'api') {
            const { data } = await axios.get(ITEM_API_URL, { timeout: 15000 });
            const rows = Array.isArray(data) ? data : (Array.isArray(data?.content) ? data.content : []);
            return res.json(rows.map(normalizeItemRow).filter(Boolean));
        }
        if (source === 'both') {
            const [dbItems, apiResp] = await Promise.all([
                dbGetItems(),
                axios.get(ITEM_API_URL, { timeout: 15000 }),
            ]);
            const apiItems = (Array.isArray(apiResp.data) ? apiResp.data :
                (Array.isArray(apiResp.data?.content) ? apiResp.data.content : []))
                .map(normalizeItemRow).filter(Boolean);
            const map = new Map();
            for (const it of [...apiItems, ...dbItems]) map.set(it.id, it);
            return res.json([...map.values()]);
        }
        // default: db
        const items = await dbGetItems();
        return res.json(items);
    } catch (err) {
        console.error('GET /api/items error:', err?.message || err);
        res.status(500).json({ message: 'Failed to fetch items.' });
    }
});

// CREATE item + asset (write-through: API -> DB -> Asset API)
app.post('/api/items', upload.none(), async (req, res) => {
    try {
        const itemName = (req.body.itemName ?? req.body.item_name ?? req.body.name ?? '').trim();

        const itemTypeId = toIntOrNull(
            req.body.itemTypeId ??
            req.body.item_type_id ??
            req.body.item_type ??
            req.body.typeId ??
            req.body.type_id
        );
        const classificationId = toIntOrNull(
            req.body.classificationId ??
            req.body.itemClassificationId ??
            req.body.item_classification_id ??
            req.body.item_classification ??
            req.body.classificationId ??
            req.body.classification_id
        );
        const employeeId = toIntOrNull(req.body.employeeId ?? req.body.employee);
        const encoderId  = toIntOrNull(req.body.encoderId  ?? req.body.encoder);

        if (!itemName || !itemTypeId || !classificationId || !employeeId || !encoderId) {
            return res.status(400).json({
                message: 'Missing required asset information (itemName, itemTypeId, classificationId, employeeId, encoderId).'
            });
        }

        // 1) Create base item in external API
        const itemPayload = {
            item_type: itemTypeId,
            item_classification: classificationId,
            item_type_id: itemTypeId,
            item_classification_id: classificationId,
            item_name: itemName,
            itemName,
            itemTypeId,
            itemClassificationId: classificationId,
        };
        if (DEBUG) console.log('[POST /api/items] -> external itemPayload', itemPayload);

        const itemResp = await axios.post(ITEM_API_URL, itemPayload, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
        });
        const newItemId = itemResp?.data?.id ?? itemResp?.data?.itemId ?? itemResp?.data?.item_id;
        if (!newItemId) throw new Error('External items API did not return new ID.');

        // 2) Mirror item into local MySQL (id must match external)
        await dbUpsertItem(newItemId, itemName, itemTypeId, classificationId);

        // 3) Resolve names (optional, for downstream display)
        const resolvedTypeName  = await getTypeNameById(itemTypeId);
        const resolvedClassName = await getClassificationNameById(classificationId);

        // 4) Create asset row in external assets API
        const assetPayload = createAssetPayload(
            { ...req.body, itemTypeName: resolvedTypeName, classificationName: resolvedClassName },
            newItemId
        );
        if (DEBUG) console.log('[POST /api/items] -> external assetPayload', assetPayload);

        const assetResp = await axios.post(ASSET_API_URL, assetPayload, {
            timeout: 20000,
            headers: { 'Content-Type': 'application/json' },
        });

        return res.status(201).json({ message: 'Asset created successfully', data: assetResp.data });
    } catch (err) {
        console.error('--- ERROR in POST /api/items ---');
        const upstreamMsg = err?.response?.data?.message || err?.response?.data?.error || err?.message || '';
        if (err.response) {
            console.error('Upstream status:', err.response.status);
            try { console.error('Upstream body:', JSON.stringify(err.response.data, null, 2)); } catch {}
        }
        return res.status(500).json({ message: 'Failed to create new asset. ' + upstreamMsg });
    }
});

// UPDATE item + asset (write-through: API -> DB -> Asset API)
app.put('/api/items/:id', upload.none(), async (req, res) => {
    try {
        const { id } = req.params;

        const itemName = (req.body.itemName ?? req.body.item_name ?? req.body.name ?? '').trim();
        const itemTypeId = toIntOrNull(
            req.body.itemTypeId ??
            req.body.item_type_id ??
            req.body.item_type ??
            req.body.typeId ??
            req.body.type_id
        );
        const classificationId = toIntOrNull(
            req.body.classificationId ??
            req.body.itemClassificationId ??
            req.body.item_classification_id ??
            req.body.item_classification ??
            req.body.classificationId ??
            req.body.classification_id
        );

        // 1) Update external item
        const itemPayload = {
            item_type: itemTypeId,
            item_classification: classificationId,
            item_type_id: itemTypeId,
            item_classification_id: classificationId,
            item_name: itemName || undefined,
            itemName: itemName || undefined,
            itemTypeId,
            itemClassificationId: classificationId,
        };
        if (DEBUG) console.log('[PUT /api/items/:id] -> external itemPayload', itemPayload);

        await axios.put(`${ITEM_API_URL}/${id}`, itemPayload, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
        });

        // 2) Mirror into local MySQL
        await dbUpdateItem(+id, itemName, itemTypeId, classificationId);

        // 3) Resolve names (optional)
        const resolvedTypeName  = await getTypeNameById(itemTypeId);
        const resolvedClassName = await getClassificationNameById(classificationId);

        // 4) Update external asset row
        const assetPayload = createAssetPayload(
            { ...req.body, itemTypeName: resolvedTypeName, classificationName: resolvedClassName },
            +id
        );
        if (DEBUG) console.log('[PUT /api/items/:id] -> external assetPayload', assetPayload);

        const assetResp = await axios.put(`${ASSET_API_URL}/${id}`, assetPayload, {
            timeout: 20000,
            headers: { 'Content-Type': 'application/json' },
        });

        return res.status(200).json({ message: 'Asset updated successfully', data: assetResp.data });
    } catch (err) {
        console.error(`--- ERROR in PUT /api/items/${req.params.id} ---`);
        const upstreamMsg = err?.response?.data?.message || err?.response?.data?.error || err?.message || '';
        if (err.response) {
            console.error('Upstream status:', err.response.status);
            try { console.error('Upstream body:', JSON.stringify(err.response.data, null, 2)); } catch {}
        }
        return res.status(500).json({ message: 'Failed to update asset. ' + upstreamMsg });
    }
});

// DELETE asset + base item (API) then mirror delete in DB
app.delete('/api/items/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ message: 'Asset ID is required.' });

        // Delete asset then item in external services
        await axios.delete(`${ASSET_API_URL}/${id}`, { timeout: 15000 });
        try {
            await axios.delete(`${ITEM_API_URL}/${id}`, { timeout: 15000 });
        } catch {
            console.warn(`Asset ${id} deleted, but deleting base item (external) failed (may be expected).`);
        }

        // Mirror delete in local DB
        try { await dbDeleteItem(+id); } catch (e) {
            console.warn(`Delete local DB row items.id=${id} failed:`, e?.message || e);
        }

        res.status(204).send();
    } catch (err) {
        console.error(`DELETE /api/items/${req.params.id} error:`, err?.message || err);
        res.status(500).json({ message: 'Failed to delete asset.' });
    }
});

// ======================================================
//               ASSETS & Reference Data (proxy)
// ======================================================
app.get('/api/assets', async (_req, res) => {
    try {
        const { data } = await axios.get(ASSET_API_URL, { timeout: 15000 });
        res.json(data?.content || (Array.isArray(data) ? data : []));
    } catch (err) {
        console.error('GET /api/assets error:', err?.message || err);
        res.status(500).json({ message: 'Failed to fetch assets from the external API.' });
    }
});

// Item Types
function normalizeTypeRow(t) {
    return {
        id: t?.id ?? t?.type_id ?? t?.typeId,
        name: t?.name ?? t?.type_name ?? t?.typeName,
    };
}
app.get('/api/item-types', async (_req, res) => {
    try {
        const { data } = await axios.get(ITEM_TYPE_API_URL, { timeout: 15000 });
        const list = (Array.isArray(data) ? data : [])
            .map(normalizeTypeRow)
            .filter(r => r && r.id != null && r.name)
            .sort((a, b) => a.name.localeCompare(b.name));
        return res.json(list);
    } catch (err) {
        const status = err?.response?.status || 500;
        const msg = err?.response?.data?.message || err?.message || 'Failed to fetch item types.';
        console.error('GET /api/item-types proxy error:', msg);
        return res.status(status >= 400 && status < 600 ? status : 500).json({ message: msg });
    }
});
app.post('/api/item-types', async (req, res) => {
    try {
        const rawName = req.body?.name ?? req.body?.typeName;
        const name = String(rawName || '').trim();
        if (!name) return res.status(400).json({ message: 'name is required.' });

        const payload = { name, typeName: name };
        const { data } = await axios.post(ITEM_TYPE_API_URL, payload, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
        });

        const created = normalizeTypeRow(data?.type ?? data ?? {});
        if (!created.name) created.name = name;

        return res.status(201).json(created);
    } catch (err) {
        const status = err?.response?.status || 500;
        let msg = err?.response?.data?.message || err?.message || 'Failed to create item type.';
        if (status === 409 || /duplicate/i.test(msg)) msg = 'An item type with the same name already exists.';
        console.error('POST /api/item-types proxy error:', msg);
        return res.status(status >= 400 && status < 600 ? status : 500).json({ message: msg });
    }
});

// Classifications
function normalizeClassificationRow(c) {
    return {
        id: c?.id ?? c?.classification_id ?? c?.classificationId,
        name: c?.name ?? c?.classification_name ?? c?.classificationName,
    };
}
app.get('/api/classifications', async (_req, res) => {
    try {
        const { data } = await axios.get(ITEM_CLASS_API_URL, { timeout: 15000 });
        const list = (Array.isArray(data) ? data : [])
            .map(normalizeClassificationRow)
            .filter(r => r && r.id != null && r.name)
            .sort((a, b) => a.name.localeCompare(b.name));
        return res.json(list);
    } catch (err) {
        const status = err?.response?.status || 500;
        const msg = err?.response?.data?.message || err?.message || 'Failed to fetch classifications.';
        console.error('GET /api/classifications proxy error:', msg);
        return res.status(status >= 400 && status < 600 ? status : 500).json({ message: msg });
    }
});
app.post('/api/classifications', async (req, res) => {
    try {
        const rawName = req.body?.name ?? req.body?.classificationName;
        const name = String(rawName || '').trim();
        if (!name) return res.status(400).json({ message: 'name is required.' });

        const payload = { name, classificationName: name };
        const { data } = await axios.post(ITEM_CLASS_API_URL, payload, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
        });

        const created = normalizeClassificationRow(data?.classification ?? data ?? {});
        if (!created.name) created.name = name;

        return res.status(201).json(created);
    } catch (err) {
        const status = err?.response?.status || 500;
        let msg = err?.response?.data?.message || err?.message || 'Failed to create classification.';
        if (status === 409 || /duplicate/i.test(msg)) msg = 'A classification with the same name already exists.';
        console.error('POST /api/classifications proxy error:', msg);
        return res.status(status >= 400 && status < 600 ? status : 500).json({ message: msg });
    }
});

// Departments
function normalizeDepartmentRow(d) {
    return {
        id: d?.id ?? d?.department_id ?? d?.departmentId,
        name: d?.name ?? d?.department_name ?? d?.departmentName,
    };
}
function pickDeptArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.content)) return payload.content;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.rows)) return payload.rows;
    return [];
}
app.get('/api/departments', async (_req, res) => {
    try {
        const { data } = await axios.get(DEPT_API_URL, { timeout: 15000 });
        const list = pickDeptArray(data)
            .map(normalizeDepartmentRow)
            .filter(r => r && r.name && r.id != null)
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return res.json(list);
    } catch (err) {
        const status = err?.response?.status || 500;
        const msg = err?.response?.data?.message || err?.message || 'Failed to fetch departments.';
        console.error('GET /api/departments proxy error:', msg);
        return res.status(status >= 400 && status < 600 ? status : 500).json({ message: msg });
    }
});
app.post('/api/departments', async (req, res) => {
    try {
        const name = String(req.body?.name ?? req.body?.departmentName ?? '').trim();
        if (!name) return res.status(400).json({ message: 'name is required.' });

        const payload = { name, departmentName: name };
        const resp = await axios.post(DEPT_API_URL, payload, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
        });

        const body = resp.data;
        const created = normalizeDepartmentRow(body?.department ?? body ?? {});
        if (!created.name) created.name = name;

        return res.status(201).json(created);
    } catch (err) {
        const status = err?.response?.status || 500;
        let msg = err?.response?.data?.message || err?.message || 'Failed to create department.';
        if (status === 409 || /duplicate/i.test(msg)) msg = 'A department with the same name already exists.';
        console.error('POST /api/departments proxy error:', msg);
        return res.status(status >= 400 && status < 600 ? status : 500).json({ message: msg });
    }
});

// ---- Global error handler ----
app.use((err, _req, res, next) => {
    const status = err.status || err.statusCode;
    if (err.type === 'entity.too.large' || status === 413) {
        return res.status(413).json({
            message: 'Uploaded image is too large. Please use an image under 20 MB.'
        });
    }
    if (/Only image files are allowed/.test(err?.message || '')) {
        return res.status(400).json({ message: 'Only image files are allowed.' });
    }
    next(err);
});

// ==============================
//   S3 Pre-signed URL endpoint (kept for compatibility)
// ==============================
function yyyymmdd(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}
function hmac(key, data, encoding) {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest(encoding);
}
function getS3Endpoint(bucket, region) {
    const host = region ? `${bucket}.s3.${region}.amazonaws.com` : `${bucket}.s3.amazonaws.com`;
    return { host, baseUrl: `https://${host}` };
}
function getFileExtensionFromContentType(ct) {
    if (!ct) return '';
    const map = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/svg+xml': '.svg',
        'image/avif': '.avif',
    };
    return map[ct] || '';
}
function makeSafeKeySegment(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 40);
}
function generateUniqueKey(filename, contentType) {
    const extFromCT = getFileExtensionFromContentType(contentType);
    const origExt = (filename && path.extname(filename)) || '';
    const ext = (extFromCT || origExt || '.bin');
    const rand = crypto.randomBytes(12).toString('hex');
    const ts = Date.now().toString(36);
    const safe = makeSafeKeySegment((filename || '').replace(/\.[^.]*$/, ''));
    return `uploads/${ts}-${rand}${safe ? '-' + safe : ''}${ext}`;
}
function presignS3PutUrl({ region, bucket, key, accessKeyId, secretAccessKey, contentType, expiresIn = 900 }) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = yyyymmdd(now);
    const { host, baseUrl } = getS3Endpoint(bucket, region);
    const method = 'PUT';
    const canonicalUri = '/' + key.split('/').map(encodeURIComponent).join('/');
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const algorithm = 'AWS4-HMAC-SHA256';

    const params = new URLSearchParams();
    params.set('X-Amz-Algorithm', algorithm);
    params.set('X-Amz-Credential', `${accessKeyId}/${credentialScope}`);
    params.set('X-Amz-Date', amzDate);
    params.set('X-Amz-Expires', String(Math.min(Math.max(1, expiresIn), 3600)));
    params.set('X-Amz-SignedHeaders', 'content-type;host');
    params.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD');

    const canonicalQuery = params.toString();
    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
    const signedHeaders = 'content-type;host';
    const payloadHash = 'UNSIGNED-PAYLOAD';

    const canonicalRequest = [
        method,
        canonicalUri,
        canonicalQuery,
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join('\n');

    const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');
    const stringToSign = [
        algorithm,
        amzDate,
        credentialScope,
        canonicalRequestHash,
    ].join('\n');

    const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = hmac(kSigning, stringToSign, 'hex');

    const presignedUrl = `${baseUrl}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
    return presignedUrl;
}

app.post('/api/upload-url', (req, res) => {
    try {
        const { S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL } = process.env;
        if (!S3_BUCKET || !AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
            return res.status(500).json({ message: 'S3 is not configured on the server.' });
        }

        const contentType = String(req.body?.contentType || '').toLowerCase();
        const size = Number(req.body?.size || 0);
        const filename = String(req.body?.filename || '').trim();

        const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif','image/svg+xml','image/avif']);
        if (!allowed.has(contentType)) {
            return res.status(400).json({ message: 'Only image files are allowed.' });
        }
        const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
        if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
            return res.status(400).json({ message: 'File size exceeds limit (20 MB).' });
        }

        const key = generateUniqueKey(filename, contentType);
        const expiresIn = 900; // 15 minutes
        const uploadUrl = presignS3PutUrl({
            region: AWS_REGION,
            bucket: S3_BUCKET,
            key,
            accessKeyId: AWS_ACCESS_KEY_ID,
            secretAccessKey: AWS_SECRET_ACCESS_KEY,
            contentType,
            expiresIn,
        });

        const fileUrl = (S3_PUBLIC_BASE_URL
            ? `${S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`
            : `${getS3Endpoint(S3_BUCKET, AWS_REGION).baseUrl}/${key}`);

        return res.json({ uploadUrl, fileUrl, key, expiresIn });
    } catch (err) {
        console.error('POST /api/upload-url error:', err?.message || err);
        return res.status(500).json({ message: 'Failed to generate upload URL.' });
    }
});

// ---- Start server ----
app.listen(PORT, HOST, () => {
    console.log(`API + static files at http://localhost:${PORT} (open http://192.168.0.65:${PORT})`);
});