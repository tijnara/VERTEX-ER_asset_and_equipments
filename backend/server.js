// WebStorm/backend/server.js
require('dotenv').config();
const express = require('express');
const pool = require('./db'); // Corrected to require the local db configuration
const axios = require('axios');
const path = require('path'); // Corrected to use the standard path module

const app = express();
const PORT = process.env.PORT || 3001;

// ---- External API addresses ----
const USER_API_URL     = 'http://goatedcodoer:8080/api/users';
const PRODUCT_API_URL  = 'http://goatedcodoer:8080/api/products';
const BRANCH_API_URL   = 'http://goatedcodoer:8080/api/branches';
const ITEM_TYPE_API_URL = 'http://goatedcodoer:8080/api/item-types';

// ---- Parsers & Static ----
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '../index.html')));

// Note: This is a very permissive CORS setup.
// For production, you might want to restrict allowedOrigins.
const allowedOrigins = ['http://localhost:3001',
    'http://192.168.0.65:3001',
    'http://localhost:63342',
    'http://localhost:63343',
    'http://192.168.100.100:3001',]; // Add specific origins if needed, e.g., ['http://localhost:63343']
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (!allowedOrigins.length) {
        // Allow any origin if the list is empty (for development)
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---- Health ----
app.get('/health', (_req, res) => res.json({ ok: true }));

// ---- Login (external) ----

// Helper: detect DB connectivity/transport errors for fast, clear responses
function isDbConnError(err) {
    const msg = String(err && err.message || '').toLowerCase();
    const code = err && (err.code || err.errno);
    const netCodes = new Set(['ETIMEDOUT','ECONNREFUSED','ECONNRESET','ENETUNREACH','EHOSTUNREACH','PROTOCOL_CONNECTION_LOST']);
    return netCodes.has(code) ||
        msg.includes('timeout') || msg.includes('timed out') ||
        msg.includes('connection lost') || msg.includes('connect') && msg.includes('refused');
}

// Optional in-memory fallback for dev when DB is unreachable
const ITEM_TYPES_FALLBACK = [];
let ITEM_TYPES_FALLBACK_ID = 1;
// Fallback stores for Departments and Classifications when DB is optional/unavailable
const DEPARTMENTS_FALLBACK = [];
let DEPARTMENTS_FALLBACK_ID = 1;
const CLASSIFICATIONS_FALLBACK = [];
let CLASSIFICATIONS_FALLBACK_ID = 1;
const DB_OPTIONAL = String(process.env.DB_OPTIONAL || 'true').toLowerCase() === 'true';

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

        const { data: users } = await axios.get(USER_API_URL, { timeout: 15000 });
        const user = (users || []).find(u => u.email === email);
        if (!user) return res.status(401).json({ message: 'Invalid credentials.' });
        if (String(password) !== String(user.password)) return res.status(401).json({ message: 'Invalid credentials.' });

        return res.json({ message: 'Login successful', userId: user.userId });
    } catch (err) {
        console.error('Login error:', err?.message || err);
        return res.status(500).json({ message: 'Could not connect to user service.' });
    }
});

// ---- Branches (external) ----
app.get('/api/branches', async (_req, res) => {
    try {
        const { data: branches } = await axios.get(BRANCH_API_URL, { timeout: 15000 });
        const active = (branches || [])
            .filter(b => b.isActive === 1)
            .map(b => ({ id: b.id, branch_name: b.branchName }))
            .sort((a, b) => a.branch_name.localeCompare(b.branch_name));
        res.json(active);
    } catch (err) {
        console.error('Branches error:', err?.message || err);
        res.status(500).json({ message: 'Could not connect to branch service.' });
    }
});

// ---- Users (external) ----
app.get('/api/users', async (_req, res) => {
    try {
        const { data: users } = await axios.get(USER_API_URL, { timeout: 15000 });
        const active = (users || [])
            .filter(u => u.isActive)
            .map(u => ({ user_id: u.userId, full_name: u.fullName }))
            .sort((a, b) => a.full_name.localeCompare(b.full_name));
        res.json(active);
    } catch (err) {
        console.error('Users error:', err?.message || err);
        res.status(500).json({ message: 'Could not connect to user service.' });
    }
});

//
// -------- PRODUCTS (LOCAL DB only) --------
//

// Return medicines (category 285) for dropdowns
app.get('/api/products', async (_req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT product_id, product_name
       FROM products
       WHERE product_category = ?
       ORDER BY product_name ASC`,
            [285]
        );
        res.json(rows || []);
    } catch (err) {
        console.error('Products GET error (local DB):', err?.message || err);
        res.status(500).json({ message: 'Could not load products from database.' });
    }
});

// Helpers for auto-generated descriptions
function cleanName(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
}
function extractHints(name) {
    const out = {};
    const strength = name.match(/\b(\d+(?:\.\d+)?)(mg|ml|g|mcg)\b/i);
    if (strength) out.strength = `${strength[1]}${strength[2].toUpperCase()}`;
    const pack = name.match(/\b(\d+\s*[xX]\s*\d+\s*(?:tabs?|caps?|pcs?|vials?)?)\b/);
    if (pack) out.pack = pack[1].replace(/\s+/g, '').toUpperCase();
    return out;
}
function buildShortDesc(name) {
    const UOM_TEXT = 'Pieces'; // unit_of_measurement = 18 → “Pieces”
    const n = cleanName(name);
    const { strength, pack } = extractHints(n);
    let s = n;
    if (strength) s += ` | ${strength}`;
    if (pack) s += ` | ${pack}`;
    s += ` | UOM: ${UOM_TEXT}`;
    if (s.length > 64) s = s.slice(0, 61) + '…';
    return s;
}
function buildLongDesc(name) {
    const UOM_TEXT = 'Pieces';
    const n = cleanName(name);
    const { strength, pack } = extractHints(n);
    const parts = [
        `${n} is registered as a medical supply item for issuance and inventory control.`,
        `Default unit of measurement: ${UOM_TEXT} (code 18).`
    ];
    if (strength) parts.push(`Labeled strength: ${strength}.`);
    if (pack) parts.push(`Typical pack: ${pack}.`);
    parts.push(`Category: Medicines (285). Auto-generated metadata is provided for search and listing convenience; edit as needed.`);
    return parts.join(' ');
}

// Create product in local DB with required defaults + auto-generated descriptions
app.post('/api/products', async (req, res) => {
    try {
        const { productName } = req.body || {};
        if (!productName || !String(productName).trim()) {
            return res.status(400).json({ message: 'productName is required.' });
        }

        const name = cleanName(productName);
        const short_description = buildShortDesc(name);
        const description = buildLongDesc(name);

        const insertSql = `
      INSERT INTO products (
        product_name,
        product_category,
        date_added,
        last_updated,
        unit_of_measurement,
        short_description,
        description
      )
      VALUES (?, 285, NOW(), NOW(), 18, ?, ?)
    `;
        const [result] = await pool.query(insertSql, [
            name,
            short_description,
            description
        ]);

        const product = { product_id: result.insertId, product_name: name };
        return res.status(201).json({ message: 'Medicine created successfully.', product });
    } catch (err) {
        console.error('Products POST error (local DB):', err?.message || err);
        if (err && (err.code === 'ER_DUP_ENTRY' || String(err.message || '').toLowerCase().includes('duplicate'))) {
            return res.status(409).json({ message: 'A medicine with the same name already exists.' });
        }
        return res.status(500).json({ message: 'Failed to create medicine in database.' });
    }
});

//
// -------- ITEM TYPES (LOCAL DB only) --------
//

// Create a new item type in the local DB
app.post('/api/item-types', async (req, res) => {
    try {
        const rawName = (req.body && (req.body.name ?? req.body.typeName)) || '';
        if (!rawName || !String(rawName).trim()) {
            return res.status(400).json({ message: 'name is required.' });
        }
        const name = cleanName(rawName);

        // Try external service first
        try {
            const payload = { name, typeName: name };
            const { data } = await axios.post(ITEM_TYPE_API_URL, payload, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
            const out = {
                id: data?.id ?? data?.type_id ?? data?.typeId,
                name: data?.name ?? data?.type_name ?? data?.typeName ?? name,
            };
            if (!out.id && data?.type) {
                out.id = data.type.id ?? data.type.type_id ?? data.type.typeId;
                out.name = data.type.name ?? data.type.type_name ?? data.type.typeName ?? out.name;
            }
            return res.status(201).json(out);
        } catch (extErr) {
            const status = extErr?.response?.status;
            if (status === 409) {
                const msg = extErr?.response?.data?.message || 'An item type with the same name already exists.';
                return res.status(409).json({ message: msg });
            }
            if (status && status < 500) {
                const msg = extErr?.response?.data?.message || 'External service rejected the request.';
                return res.status(status).json({ message: msg });
            }
            console.warn('External item-type service unavailable, falling back to local DB:', extErr?.message || extErr);
        }

        // Fallback to local DB
        const insertSql = `
            INSERT INTO item_types (type_name)
            VALUES (?)
        `;
        try {
            const [result] = await pool.query(insertSql, [name]);
            return res.status(201).json({ id: result.insertId, name });
        } catch (dbErr) {
            if (isDbConnError(dbErr)) {
                console.error('Item Types DB connection error:', dbErr?.message || dbErr);
                if (DB_OPTIONAL) {
                    const id = ITEM_TYPES_FALLBACK_ID++;
                    ITEM_TYPES_FALLBACK.push({ id, name });
                    return res.status(201).json({ id, name, fallback: true });
                }
                return res.status(503).json({ message: 'Database is unreachable for item types. Check DB settings/network or enable DB_OPTIONAL=true for dev fallback.' });
            }
            if (dbErr && (dbErr.code === 'ER_DUP_ENTRY' || String(dbErr.message || '').toLowerCase().includes('duplicate'))) {
                return res.status(409).json({ message: 'An item type with the same name already exists.' });
            }
            throw dbErr;
        }
    } catch (err) {
        console.error('Item Types POST error:', err?.message || err);
        return res.status(500).json({ message: 'Failed to create item type.' });
    }
});

// Item Types: external-first (goatedcodoer) with graceful fallbacks to local DB and in-memory
app.get('/api/item-types', async (_req, res) => {
    try {
        // Try external service first
        try {
            const { data: types } = await axios.get(ITEM_TYPE_API_URL, { timeout: 15000 });
            const data = (types || []).map(t => ({
                id: t?.id ?? t?.type_id ?? t?.typeId,
                name: t?.name ?? t?.type_name ?? t?.typeName
            })).filter(x => x && x.name).sort((a, b) => a.name.localeCompare(b.name));
            return res.json(data);
        } catch (extErr) {
            // If external service responds with an error code, or connectivity fails, fall back to local DB
            const status = extErr?.response?.status;
            if (status) {
                console.warn('Item Types external service error status:', status);
            } else {
                console.error('Item Types external connectivity error:', extErr?.message || extErr);
            }

            const selectSql = 'SELECT id, type_name FROM item_types ORDER BY type_name ASC';
            try {
                const [rows] = await pool.query(selectSql);
                const data = (rows || []).map(r => ({ id: r.id, name: r.type_name }));
                return res.json(data);
            } catch (dbErr) {
                if (isDbConnError(dbErr)) {
                    console.error('Item Types GET DB connection error:', dbErr?.message || dbErr);
                    if (DB_OPTIONAL) {
                        return res.json(ITEM_TYPES_FALLBACK.map(x => ({ id: x.id, name: x.name })));
                    }
                    return res.status(503).json({ message: 'Database is unreachable for item types.' });
                }
                throw dbErr;
            }
        }
    } catch (err) {
        console.error('Item Types GET error:', err?.message || err);
        return res.status(500).json({ message: 'Failed to load item types.' });
    }
});

//
// -------- DEPARTMENTS (LOCAL DB first, in-memory fallback) --------
//
app.get('/api/departments', async (_req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, name FROM departments ORDER BY name ASC');
        const data = (rows || []).map(r => ({ id: r.id, name: r.name }));
        return res.json(data);
    } catch (dbErr) {
        if (isDbConnError(dbErr)) {
            console.error('Departments GET DB connection error:', dbErr?.message || dbErr);
            if (DB_OPTIONAL) {
                return res.json(DEPARTMENTS_FALLBACK.map(x => ({ id: x.id, name: x.name })));
            }
            return res.status(503).json({ message: 'Database is unreachable for departments.' });
        }
        console.error('Departments GET error:', dbErr?.message || dbErr);
        return res.status(500).json({ message: 'Failed to load departments.' });
    }
});

app.post('/api/departments', async (req, res) => {
    try {
        const rawName = (req.body && (req.body.name ?? req.body.departmentName)) || '';
        const name = String(rawName || '').trim();
        if (!name) return res.status(400).json({ message: 'name is required.' });
        try {
            const [result] = await pool.query('INSERT INTO departments (name) VALUES (?)', [name]);
            return res.status(201).json({ id: result.insertId, name });
        } catch (dbErr) {
            if (isDbConnError(dbErr)) {
                console.error('Departments POST DB connection error:', dbErr?.message || dbErr);
                if (DB_OPTIONAL) {
                    const id = DEPARTMENTS_FALLBACK_ID++;
                    DEPARTMENTS_FALLBACK.push({ id, name });
                    return res.status(201).json({ id, name, fallback: true });
                }
                return res.status(503).json({ message: 'Database is unreachable for departments.' });
            }
            if (dbErr && (dbErr.code === 'ER_DUP_ENTRY' || String(dbErr.message || '').toLowerCase().includes('duplicate'))) {
                return res.status(409).json({ message: 'A department with the same name already exists.' });
            }
            throw dbErr;
        }
    } catch (err) {
        console.error('Departments POST error:', err?.message || err);
        return res.status(500).json({ message: 'Failed to create department.' });
    }
});

//
// -------- CLASSIFICATIONS (LOCAL DB first, in-memory fallback) --------
//
app.get('/api/classifications', async (_req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, name FROM classifications ORDER BY name ASC');
        const data = (rows || []).map(r => ({ id: r.id, name: r.name }));
        return res.json(data);
    } catch (dbErr) {
        if (isDbConnError(dbErr)) {
            console.error('Classifications GET DB connection error:', dbErr?.message || dbErr);
            if (DB_OPTIONAL) {
                return res.json(CLASSIFICATIONS_FALLBACK.map(x => ({ id: x.id, name: x.name })));
            }
            return res.status(503).json({ message: 'Database is unreachable for classifications.' });
        }
        console.error('Classifications GET error:', dbErr?.message || dbErr);
        return res.status(500).json({ message: 'Failed to load classifications.' });
    }
});

app.post('/api/classifications', async (req, res) => {
    try {
        const rawName = (req.body && (req.body.name ?? req.body.classificationName)) || '';
        const name = String(rawName || '').trim();
        if (!name) return res.status(400).json({ message: 'name is required.' });
        try {
            const [result] = await pool.query('INSERT INTO classifications (name) VALUES (?)', [name]);
            return res.status(201).json({ id: result.insertId, name });
        } catch (dbErr) {
            if (isDbConnError(dbErr)) {
                console.error('Classifications POST DB connection error:', dbErr?.message || dbErr);
                if (DB_OPTIONAL) {
                    const id = CLASSIFICATIONS_FALLBACK_ID++;
                    CLASSIFICATIONS_FALLBACK.push({ id, name });
                    return res.status(201).json({ id, name, fallback: true });
                }
                return res.status(503).json({ message: 'Database is unreachable for classifications.' });
            }
            if (dbErr && (dbErr.code === 'ER_DUP_ENTRY' || String(dbErr.message || '').toLowerCase().includes('duplicate'))) {
                return res.status(409).json({ message: 'A classification with the same name already exists.' });
            }
            throw dbErr;
        }
    } catch (err) {
        console.error('Classifications POST error:', err?.message || err);
        return res.status(500).json({ message: 'Failed to create classification.' });
    }
});

//
// -------- Issuance (LOCAL DB for issuance only) --------
//
app.post('/api/issue', async (req, res) => {
    const { branch_id, employee_id, issue_date, remarks, status, items, userId } = req.body;
    if (!branch_id || !employee_id || !issue_date || !items || !items.length || !userId) {
        return res.status(400).json({ message: 'Missing required fields, or user is not identified.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const issueSql = `
            INSERT INTO medical_supply_issue (issue_no, branch_id, employee_id, status, issue_date, remarks, created_by)
            VALUES ('TEMP', ?, ?, ?, ?, ?, ?);
        `;
        const [issueResult] = await connection.query(issueSql, [branch_id, employee_id, status, issue_date, remarks, userId]);
        const issueId = issueResult.insertId;

        const newIssueNo = `ISS-${new Date().getFullYear()}-${String(issueId).padStart(6, '0')}`;
        await connection.query(`UPDATE medical_supply_issue SET issue_no = ? WHERE id = ?`, [newIssueNo, issueId]);

        if (status === 'Approved') {
            await connection.query(
                `UPDATE medical_supply_issue SET approved_by = ?, approved_at = NOW() WHERE id = ?`,
                [userId, issueId]
            );
        }

        const lineSql = `
            INSERT INTO medical_supply_issue_line (issue_id, product_id, qty, uom, batch_no, expiry_date)
            VALUES (?, ?, ?, ?, ?, ?);
        `;
        for (const item of items) {
            if (!item.product_id || !item.qty) throw new Error('Each item must have a product and quantity.');
            const expiry = item.expiry_date === '' ? null : item.expiry_date;
            await connection.query(lineSql, [issueId, item.product_id, item.qty, item.uom, item.batch_no, expiry]);
        }

        await connection.commit();
        res.status(201).json({ message: 'Issuance created successfully!', issueId, issueNo: newIssueNo });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('Issuance error:', err?.message || err);
        res.status(500).json({ message: 'Failed to create issuance.', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// ---- Start server ----
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    // A more robust way to find a non-localhost IP for display
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const results = {};
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                if (!results[name]) {
                    results[name] = [];
                }
                results[name].push(net.address);
            }
        }
    }
    const localIp = results.Ethernet?.[0] || results['Wi-Fi']?.[0] || '127.0.0.1';

    console.log(`API + static files at http://localhost:${PORT} (or http://${localIp}:${PORT} on your local network)`);
});

// ---- Assets (placeholder route) ----
app.get('/api/items', async (_req, res) => {
    try {
        // Placeholder: return empty assets list; wire to DB when available
        res.json([]);
    } catch (err) {
        console.error('Items GET error:', err?.message || err);
        res.status(500).json({ message: 'Failed to load items.' });
    }
});
