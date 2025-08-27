// WebStorm/backend/server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const axios = require('axios');
// Allow large payloads through Axios when forwarding base64 images
axios.defaults.maxBodyLength = Infinity;
axios.defaults.maxContentLength = Infinity;
const cors = require('cors');
const pool = require('./db'); // currently unused, but kept

const app = express();
const PORT = process.env.PORT || 3001;

// ---- CORS ----
const allowedOrigins = [
    'http://localhost:3001',
    `http://192.168.0.65:${PORT}`,
    'http://localhost:63343',
    'http://127.0.0.1:63343',
    'null', // allow file:// origins
    ...((process.env.CORS_ORIGIN || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)),
];

// Increase body size limits to accommodate base64 image uploads
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));
app.use(cors({ origin: allowedOrigins }));

// ---- Serve frontend ----
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (_req, res) =>
    res.sendFile(path.join(__dirname, '../frontend/index.html'))
);

// ---- External API addresses ----
const EXTERNAL_API_BASE = 'http://goatedcodoer:8080/api';

const USER_API_URL       = `${EXTERNAL_API_BASE}/users`;
const ITEM_CLASS_API_URL = `${EXTERNAL_API_BASE}/item-classifications`;
const ITEM_TYPE_API_URL  = `${EXTERNAL_API_BASE}/item-types`;
const DEPT_API_URL       = `${EXTERNAL_API_BASE}/departments`;
const ITEM_API_URL       = `${EXTERNAL_API_BASE}/items`;
const ASSET_API_URL      = `${EXTERNAL_API_BASE}/assets`;

// ---- Health ----
app.get('/health', (_req, res) => res.json({ ok: true }));

// ---- Auth (demo only) ----
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

// ---- Users (proxy) ----
app.get('/api/users', async (_req, res) => {
    try {
        const { data } = await axios.get(USER_API_URL, { timeout: 15000 });
        const activeUsers = (Array.isArray(data) ? data : [])
            .filter(u => u.isActive)
            .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
        res.json(activeUsers);
    } catch (err) {
        console.error('Users error:', err?.message || err);
        res.status(500).json({ message: 'Could not connect to user service.' });
    }
});

// ---------- Asset Manager API Integration ----------

// helpers
function toInt(v, def = null) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
}
function toFloat(v, def = 0) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : def;
}
function toISODate(v) {
    try {
        return v ? new Date(v).toISOString() : null;
    } catch { return null; }
}

/**
 * Build the payload for /api/assets to match your DB columns.
 * - cost_per_item, total
 * - date_acquired and date_created (from Purchase Date)
 * - life_span (years -> months)
 * - condition
 * - employee, encoder (IDs from user table)
 * - item_image (TEXT or base64)
 */
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

// GET all assets (proxy list)
app.get('/api/items', async (_req, res) => {
    try {
        const { data } = await axios.get(ASSET_API_URL, { timeout: 15000 });
        res.json(data.content || []);
    } catch (err) {
        console.error('GET /api/items error:', err?.message || err);
        res.status(500).json({ message: 'Failed to fetch assets from the external API.' });
    }
});

// CREATE item + asset (2-step)
app.post('/api/items', async (req, res) => {
    try {
        const {
            itemName,
            itemTypeId,        // FK: item_type.id
            employeeId,
            encoderId,
        } = req.body;

        const classificationId = req.body.classificationId ?? req.body.itemClassificationId;

        if (!itemName || !itemTypeId || !classificationId || !employeeId || !encoderId) {
            return res.status(400).json({ message: 'Missing required asset information.' });
        }

        // 1) base item
        const itemPayload = {
            // keep camelCase for compatibility, but ensure DB columns receive correct values
            itemName,
            itemTypeId: +itemTypeId,
            itemClassificationId: +classificationId,
            // required DB column mappings
            item_name: itemName,
            item_type: +itemTypeId,
            item_classification: +classificationId,
        };
        const itemResp = await axios.post(ITEM_API_URL, itemPayload, { timeout: 15000 });
        const newItemId = itemResp?.data?.id;
        if (!newItemId) throw new Error('Failed to get new ID from item creation response.');

        // 2) detailed asset row
        const assetPayload = createAssetPayload(req.body, newItemId);
        const assetResp = await axios.post(ASSET_API_URL, assetPayload, { timeout: 20000 });

        return res.status(201).json({ message: 'Asset created successfully', data: assetResp.data });
    } catch (err) {
        console.error('--- ERROR in POST /api/items ---');
        const upstreamMsg = err?.response?.data?.message || err?.response?.data?.error || err?.message || '';
        const combined = ((typeof err?.response?.data === 'string') ? err.response.data : JSON.stringify(err?.response?.data || {})) + ' ' + upstreamMsg;
        if (/data too long|truncated|too long/i.test(combined)) {
            return res.status(422).json({
                message: 'The image data is too large for the server to store. Please upload a smaller image (try under 1 MB or reduce dimensions).'
            });
        }
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
        } else if (err.request) {
            console.error('Request Error: No response received. Is the target API running?');
        } else {
            console.error('Error', err.message);
        }
        return res.status(500).json({ message: 'Failed to create new asset. Check backend logs for details.' });
    }
});

// UPDATE item + asset
app.put('/api/items/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const classificationId = req.body.classificationId ?? req.body.itemClassificationId;

        const itemPayload = {
            // keep camelCase for compatibility, but ensure DB columns receive correct values
            itemName: req.body.itemName,
            itemTypeId: +req.body.itemTypeId,
            itemClassificationId: +classificationId,
            // required DB column mappings
            item_name: req.body.itemName,
            item_type: +req.body.itemTypeId,
            item_classification: +classificationId,
        };
        await axios.put(`${ITEM_API_URL}/${id}`, itemPayload, { timeout: 15000 });

        const assetPayload = createAssetPayload(req.body, +id);
        const assetResp = await axios.put(`${ASSET_API_URL}/${id}`, assetPayload, { timeout: 20000 });

        return res.status(200).json({ message: 'Asset updated successfully', data: assetResp.data });
    } catch (err) {
        console.error(`--- ERROR in PUT /api/items/${req.params.id} ---`);
        const upstreamMsg = err?.response?.data?.message || err?.response?.data?.error || err?.message || '';
        const combined = ((typeof err?.response?.data === 'string') ? err.response.data : JSON.stringify(err?.response?.data || {})) + ' ' + upstreamMsg;
        if (/data too long|truncated|too long/i.test(combined)) {
            return res.status(422).json({
                message: 'The image data is too large for the server to store. Please upload a smaller image (try under 1 MB or reduce dimensions).'
            });
        }
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
        } else if (err.request) {
            console.error('Request Error: No response received. Is the target API running?');
        } else {
            console.error('Error', err.message);
        }
        return res.status(500).json({ message: 'Failed to update asset. Check backend logs for details.' });
    }
});

// DELETE asset (+ try delete base item)
app.delete('/api/items/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ message: 'Asset ID is required.' });

        await axios.delete(`${ASSET_API_URL}/${id}`, { timeout: 15000 });

        try {
            await axios.delete(`${ITEM_API_URL}/${id}`, { timeout: 15000 });
        } catch {
            console.warn(`Asset ${id} deleted, but deleting base item failed (may be expected).`);
        }

        res.status(204).send();
    } catch (err) {
        console.error(`DELETE /api/items/${req.params.id} error:`, err?.message || err);
        res.status(500).json({ message: 'Failed to delete asset.' });
    }
});

// ---------- ITEM TYPES ----------
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
        if (status === 409 || /duplicate/i.test(msg)) {
            msg = 'An item type with the same name already exists.';
        }
        console.error('POST /api/item-types proxy error:', msg);
        return res.status(status >= 400 && status < 600 ? status : 500).json({ message: msg });
    }
});

// ---------- CLASSIFICATIONS ----------
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
        if (status === 409 || /duplicate/i.test(msg)) {
            msg = 'A classification with the same name already exists.';
        }
        console.error('POST /api/classifications proxy error:', msg);
        return res.status(status >= 400 && status < 600 ? status : 500).json({ message: msg });
    }
});

// ---------- DEPARTMENTS ----------
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
        if (status === 409 || /duplicate/i.test(msg)) {
            msg = 'A department with the same name already exists.';
        }
        console.error('POST /api/departments proxy error:', msg);
        return res.status(status >= 400 && status < 600 ? status : 500).json({ message: msg });
    }
});

// ---- Global error handler ----
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode;
    if (err.type === 'entity.too.large' || status === 413) {
        return res.status(413).json({
            message: 'Uploaded image is too large. Please use an image under 20 MB.'
        });
    }
    next(err);
});

// ---- Start server ----
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`API + static files at http://localhost:${PORT} (open http://192.168.0.65:${PORT})`);
});
