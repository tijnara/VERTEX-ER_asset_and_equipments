// WebStorm/backend/server.js
require('dotenv').config();
const express = require('express');
const pool = require('./db'); // Corrected to require the local db configuration
const axios = require('axios');
const path = require('path'); // Corrected to use the standard path module

const app = express();
const PORT = process.env.PORT || 3000;

// ---- External API addresses ----
const USER_API_URL    = 'http://goatedcodoer:8080/api/users';
const PRODUCT_API_URL = 'http://goatedcodoer:8080/api/products';
const BRANCH_API_URL  = 'http://goatedcodoer:8080/api/branches';

// ---- Parsers & Static ----
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

// Note: This is a very permissive CORS setup.
// For production, you might want to restrict allowedOrigins.
const allowedOrigins = []; // Add specific origins if needed, e.g., ['http://localhost:63343']
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
        const { typeName } = req.body || {};
        if (!typeName || !String(typeName).trim()) {
            return res.status(400).json({ message: 'typeName is required.' });
        }

        const name = cleanName(typeName);

        const insertSql = `
      INSERT INTO item_types (type_name)
      VALUES (?)
    `;
        const [result] = await pool.query(insertSql, [name]);

        const type = { type_id: result.insertId, type_name: name };
        return res.status(201).json({ message: 'Item Type created successfully.', type });
    } catch (err) {
        console.error('Item Types POST error (local DB):', err?.message || err);
        if (err && (err.code === 'ER_DUP_ENTRY' || String(err.message || '').toLowerCase().includes('duplicate'))) {
            return res.status(409).json({ message: 'An item type with the same name already exists.' });
        }
        return res.status(500).json({ message: 'Failed to create item type in database.' });
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