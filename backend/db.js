// WebStorm/backend/db.js
const mysql = require("mysql2/promise");
require("dotenv").config();

// Create and export the MySQL connection pool
const mysqlPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Fail fast when DB is unreachable
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 5000),
    // Keep TCP connection healthy in long-running servers
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
});

module.exports = mysqlPool;