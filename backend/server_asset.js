// Import necessary packages
const express = require('express');
const cors = require('cors');
const multer = require('multer'); // To handle file uploads
const path = require('path');     // To handle file paths

// Ensure fetch is defined for Node.js runtime and IDE inspections.
// In Node 18+, fetch is available globally. This alias silences IDE errors without adding deps.
const fetch = (...args) => {
    if (typeof global.fetch === 'function') {
        return global.fetch(...args);
    }
    // If running on an older Node, fail fast with a clear message.
    return Promise.reject(new Error('Global fetch is not available. Please run on Node 18+ or newer.'));
};

// Initialize the Express app
const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const API_SOURCE = process.env.API_SOURCE || 'http://goatedcodoer:8080/api';

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Serve static files from the 'uploads' directory ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Serve frontend (static) ---
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));
app.get('/', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// --- Multer Configuration for File Uploads ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/'); },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// --- Generic Proxy Handler Function ---
const proxyRequest = async (req, res, endpoint) => {
    try {
        const targetUrl = `${API_SOURCE}${endpoint}`;
        console.log(`Proxying ${req.method} request to: ${targetUrl}`);

        const options = { method: req.method, headers: {} };

        // Forward Accept header if present, prefer JSON
        options.headers['Accept'] = req.headers['accept'] || 'application/json, text/plain;q=0.9, */*;q=0.8';

        // Only attach JSON body and header for non-GET/HEAD requests
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(req.body || {});
        }

        const apiResponse = await fetch(targetUrl, options);

        // No Content
        if (apiResponse.status === 204) {
            return res.status(204).send();
        }

        // Try to decide how to read the response body
        const contentType = apiResponse.headers.get('content-type') || '';
        let payload;
        let isJson = /application\/json|\+json/i.test(contentType);

        if (isJson) {
            // Attempt JSON parse; if it fails, fall back to text
            try {
                payload = await apiResponse.json();
            } catch (e) {
                const txt = await apiResponse.text().catch(() => '');
                payload = txt ? { message: txt } : {};
                isJson = true; // still send as JSON object
            }
        } else {
            // Non-JSON: read as text; may be empty
            const txt = await apiResponse.text().catch(() => '');
            payload = txt;
        }

        // Return with original status; if JSON, send as JSON, else as text
        if (apiResponse.ok) {
            if (isJson) return res.status(apiResponse.status).json(payload);
            return res.status(apiResponse.status).send(payload);
        } else {
            if (isJson) return res.status(apiResponse.status).json(payload);
            return res.status(apiResponse.status).send(payload);
        }
    } catch (error) {
        console.error(`Error proxying request to ${endpoint}:`, error);
        res.status(500).json({ message: 'Server error while proxying request.' });
    }
};

// --- API Endpoints (Routes) ---
// REAL UPLOAD ENDPOINT (multer saves the file, returns absolute URL)
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file was uploaded.' });
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    console.log('File uploaded successfully. URL:', fileUrl);
    res.status(200).json({ url: fileUrl });
});

// GET routes for dropdown data
app.get('/api/users', (req, res) => proxyRequest(req, res, '/users'));
app.get('/api/items', (req, res) => proxyRequest(req, res, '/items'));
app.get('/api/departments', (req, res) => proxyRequest(req, res, '/departments'));
app.get('/api/item-types', (req, res) => proxyRequest(req, res, '/item-types'));
app.get('/api/item-classifications', (req, res) => proxyRequest(req, res, '/item-classifications'));

// POST routes for the '+' buttons in the modal
app.post('/api/items', (req, res) => proxyRequest(req, res, '/items'));
app.post('/api/item-types', (req, res) => proxyRequest(req, res, '/item-types'));
app.post('/api/item-classifications', (req, res) => proxyRequest(req, res, '/item-classifications'));

// Additional CRUD routes for items and related resources
app.put('/api/items/:id', (req, res) => proxyRequest(req, res, `/items/${req.params.id}`));
app.delete('/api/items/:id', (req, res) => proxyRequest(req, res, `/items/${req.params.id}`));
app.delete('/api/item-types/:id', (req, res) => proxyRequest(req, res, `/item-types/${req.params.id}`));
app.delete('/api/item-classifications/:id', (req, res) => proxyRequest(req, res, `/item-classifications/${req.params.id}`));

// Main Asset CRUD routes
app.get('/api/assets', (req, res) => proxyRequest(req, res, '/assets'));
app.post('/api/assets', (req, res) => proxyRequest(req, res, '/assets'));
app.put('/api/assets/:id', (req, res) => proxyRequest(req, res, `/assets/${req.params.id}`));
app.delete('/api/assets/:id', (req, res) => proxyRequest(req, res, `/assets/${req.params.id}`));

// --- Start the Server ---
app.listen(PORT, HOST, () => {
    const localUrl = `http://localhost:${PORT}`;
    const hostUrl = HOST === '0.0.0.0' ? localUrl : `http://${HOST}:${PORT}`;
    const tailscaleIp = process.env.TAILSCALE_IP || '100.119.3.44';
    console.log(`✅ Server is running on ${hostUrl} (also try ${localUrl})`);
    console.log(`🌐 If using Tailscale, access: http://${tailscaleIp}:${PORT}`);
    console.log(`Proxying requests to: ${API_SOURCE}`);
});
