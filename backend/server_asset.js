// Import necessary packages
const express = require('express');
const cors = require('cors');
const multer = require('multer'); // To handle file uploads
const path = require('path');     // To handle file paths
const fs = require('fs');         // To ensure uploads directory exists

// --- SUPABASE CLIENT ---
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be defined in .env file');
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);
// --- END SUPABASE CLIENT ---

// Initialize the Express app
const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Serve static files from the 'uploads' directory ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Serve frontend (static) ---
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// --- Multer Configuration for File Uploads ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        try {
            const dir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            cb(null, dir);
        } catch (e) {
            console.error('Failed to prepare uploads directory:', e);
            cb(e, path.join(__dirname, 'uploads'));
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// --- Generic Supabase Error Handler ---
const handleSupabaseError = (res, error, context) => {
    console.error(`Supabase error [${context}]:`, error.message);
    return res.status(500).json({ message: `Database error: ${error.message}` });
};

// --- API Endpoints (Routes) ---


// --- User Routes ---
app.get('/api/users', async (req, res) => {
    const { data, error } = await supabase
        .from('users_app')
        .select('*');
    if (error) return handleSupabaseError(res, error, 'GET /api/users');
    res.status(200).json(data);
});

// --- Department Routes ---
app.get('/api/departments', async (req, res) => {
    const { data, error } = await supabase
        .from('departments')
        .select('*');
    if (error) return handleSupabaseError(res, error, 'GET /api/departments');
    res.status(200).json(data);
});

// --- Item Type Routes ---
app.get('/api/item-types', async (req, res) => {
    const { data, error } = await supabase
        .from('item_types')
        .select('*');
    if (error) return handleSupabaseError(res, error, 'GET /api/item-types');
    res.status(200).json(data);
});

app.post('/api/item-types', async (req, res) => {
    const { typename } = req.body;
    if (!typename) return res.status(400).json({ message: 'typename is required' });
    const { data, error } = await supabase
        .from('item_types')
        .insert({ typename })
        .select()
        .single();
    if (error) return handleSupabaseError(res, error, 'POST /api/item-types');
    res.status(201).json(data);
});

app.delete('/api/item-types/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase
        .from('item_types')
        .delete()
        .eq('id', id);
    if (error) return handleSupabaseError(res, error, 'DELETE /api/item-types');
    res.status(204).send();
});

// --- Item Classification Routes ---
app.get('/api/item-classifications', async (req, res) => {
    const { data, error } = await supabase
        .from('item_classifications')
        .select('*');
    if (error) return handleSupabaseError(res, error, 'GET /api/item-classifications');
    res.status(200).json(data);
});

app.post('/api/item-classifications', async (req, res) => {
    const { classificationname } = req.body;
    if (!classificationname) return res.status(400).json({ message: 'classificationname is required' });
    const { data, error } = await supabase
        .from('item_classifications')
        .insert({ classificationname })
        .select()
        .single();
    if (error) return handleSupabaseError(res, error, 'POST /api/item-classifications');
    res.status(201).json(data);
});

app.delete('/api/item-classifications/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase
        .from('item_classifications')
        .delete()
        .eq('id', id);
    if (error) return handleSupabaseError(res, error, 'DELETE /api/item-classifications');
    res.status(204).send();
});

// --- Item Routes (with helper functions) ---
// Helper to find item type/class IDs by name if not provided
async function resolveItemIdsByName(body) {
    const out = { ...body };
    const lc = (s) => (s ?? '').toString().trim().toLowerCase();
    const typeName = out.itemTypeName || out.typeName;
    const className = out.classificationName || out.itemClassificationName;
    const hasTypeId = out.itemtypeid != null || out.itemTypeId != null;
    const hasClassId = out.itemclassificationid != null || out.itemClassificationId != null;
    if (!hasTypeId && typeName) {
        const { data, error } = await supabase
            .from('item_types')
            .select('id')
            .ilike('typename', typeName)
            .single();
        if (data && data.id) {
            out.itemtypeid = data.id;
        }
    }
    if (!hasClassId && className) {
        const { data, error } = await supabase
            .from('item_classifications')
            .select('id')
            .ilike('classificationname', className)
            .single();
        if (data && data.id) {
            out.itemclassificationid = data.id;
        }
    }
    return out;
}
// Helper to map aliases from frontend to the Supabase schema
function normalizeItemForSupabase(body) {
    return {
        itemname: body.itemname || body.itemName || body.item_name,
        itemtypeid: body.itemtypeid || body.itemTypeId || body.typeId,
        itemclassificationid: body.itemclassificationid || body.itemClassificationId || body.classificationId
    };
}
app.get('/api/items', async (req, res) => {
    const { data, error } = await supabase
        .from('items')
        .select(`*,item_types (id, typename),item_classifications (id, classificationname)`);
    if (error) return handleSupabaseError(res, error, 'GET /api/items');
    const enriched = data.map(item => {
        return {
            ...item,
            itemType: item.item_types,
            itemClassification: item.item_classifications,
            itemTypeName: item.item_types?.typename,
            classificationName: item.item_classifications?.classificationname
        };
    });
    res.status(200).json(enriched);
});
app.post('/api/items', async (req, res) => {
    try {
        const bodyWithIds = await resolveItemIdsByName(req.body);
        const newItem = normalizeItemForSupabase(bodyWithIds);
        // Remove id if present, so Supabase/Postgres can auto-generate it
        if ('id' in newItem) delete newItem.id;
        if (!newItem.itemname) return res.status(400).json({ message: 'itemname is required' });
        const { data, error } = await supabase
            .from('items')
            .insert(newItem)
            .select()
            .single();
        if (error) return handleSupabaseError(res, error, 'POST /api/items');
        res.status(201).json(data);
    } catch (e) {
        res.status(500).json({ message: `Server error: ${e.message}` });
    }
});
app.put('/api/items/:id', async (req, res) => {
    try {
        const bodyWithIds = await resolveItemIdsByName(req.body);
        const updatedItem = normalizeItemForSupabase(bodyWithIds);
        Object.keys(updatedItem).forEach(key => updatedItem[key] === undefined && delete updatedItem[key]);
        const { data, error } = await supabase
            .from('items')
            .update(updatedItem)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) return handleSupabaseError(res, error, 'PUT /api/items/:id');
        res.status(200).json(data);
    } catch (e) {
        res.status(500).json({ message: `Server error: ${e.message}` });
    }
});
app.delete('/api/items/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase
        .from('items')
        .delete()
        .eq('id', id);
    if (error) return handleSupabaseError(res, error, 'DELETE /api/items/:id');
    res.status(204).send();
});

// --- Asset Routes (with helper functions) ---
// Helper to find missing asset links (e.g., get type/class from item)
async function resolveAssetLinks(body) {
    const out = { ...body };
    const hasTid = out.itemtypeid != null || out.itemTypeId != null;
    const hasCid = out.itemclassificationid != null || out.itemClassificationId != null;
    const itemId = out.itemid || out.itemId;
    if (itemId != null && (!hasTid || !hasCid)) {
        const { data: itemData, error } = await supabase
            .from('items')
            .select('itemtypeid, itemclassificationid')
            .eq('id', itemId)
            .single();
        if (itemData) {
            if (!hasTid && itemData.itemtypeid != null) {
                out.itemtypeid = itemData.itemtypeid;
            }
            if (!hasCid && itemData.itemclassificationid != null) {
                out.itemclassificationid = itemData.itemclassificationid;
            }
        }
    }
    return out;
}
// Helper to map all old aliases to the new Supabase schema
function normalizeAssetForSupabase(body) {
    const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
    };
    const normalizeDate = (v) => {
        if (!v) return undefined;
        try {
            const d = new Date(v);
            if (isNaN(d.getTime())) return undefined;
            return d.toISOString().split('T')[0];
        } catch {
            return undefined;
        }
    };
    // Map all possible frontend names to one Supabase column name
    const cost = toNum(body.totalCost ?? body.costPerItem ?? body.price ?? body.cost);
    const date = normalizeDate(body.purchaseDate ?? body.dateAcquired);
    const asset = {
        itemid:             toNum(body.itemid || body.itemId),
        itemname:           body.itemname || body.itemName || body.item_name,
        itemtypeid:         toNum(body.itemtypeid || body.itemTypeId),
        itemclassificationid: toNum(body.itemclassificationid || body.itemClassificationId),
        departmentid:       toNum(body.departmentid || body.departmentId),
        employeeid:         toNum(body.employeeid || body.employeeId),
        purchasedate:       date,
        totalcost:          cost,
        itemimage:          body.itemimage || body.itemImage || body.imageUrl,
        quantity:           toNum(body.quantity ?? body.qty) ?? 1,
        lifespan:           toNum(body.lifeSpan ?? body.lifespan),
        condition:          body.condition ?? body.status,
        rfidcode:           body.rfidcode || body.rfidCode,
        barcode:            body.barcode || body.barCode
    };
    // Remove any keys that are undefined
    Object.keys(asset).forEach(key => asset[key] === undefined && delete asset[key]);
    return asset;
}
app.get('/api/assets', async (req, res) => {
    const { data, error } = await supabase
        .from('assets')
        .select(`*,item:items (id, itemname),item_type:item_types (id, typename),item_classification:item_classifications (id, classificationname),department:departments (departmentid, departmentname),employee:users_app!assets_employeeid_fkey (userid, fullname),encoder:users_app!assets_encoderid_fkey (userid, fullname)`);
    if (error) return handleSupabaseError(res, error, 'GET /api/assets');
    res.status(200).json(data);
});
app.post('/api/assets', async (req, res) => {
    try {
        const bodyWithLinks = await resolveAssetLinks(req.body);
        const newAsset = normalizeAssetForSupabase(bodyWithLinks);
        delete newAsset.id;
        const { data, error } = await supabase
            .from('assets')
            .insert(newAsset)
            .select()
            .single();
        if (error) return handleSupabaseError(res, error, 'POST /api/assets');
        res.status(201).json(data);
    } catch (e) {
        res.status(500).json({ message: `Server error: ${e.message}` });
    }
});
app.put('/api/assets/:id', async (req, res) => {
    try {
        const bodyWithLinks = await resolveAssetLinks(req.body);
        const updatedAsset = normalizeAssetForSupabase(bodyWithLinks);
        delete updatedAsset.id;
        const { data, error } = await supabase
            .from('assets')
            .update(updatedAsset)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) return handleSupabaseError(res, error, 'PUT /api/assets/:id');
        res.status(200).json(data);
    } catch (e) {
        res.status(500).json({ message: `Server error: ${e.message}` });
    }
});
app.delete('/api/assets/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase
        .from('assets')
        .delete()
        .eq('id', id);
    if (error) return handleSupabaseError(res, error, 'DELETE /api/assets/:id');
    res.status(204).send();
});

// --- Start the Server ---
app.listen(PORT, HOST, () => {
    console.log(`✅ Server is running on http://localhost:${PORT}`);
    console.log(`📡 Connected to Supabase project`);
});