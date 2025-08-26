// WebStorm/backend/db.js
const mysql = require("mysql2/promise");
require("dotenv").config();

// Create and export the MySQL connection pool
const mysqlPool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

module.exports = mysqlPool;