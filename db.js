// db.js
require('dotenv').config();        // load DATABASE_URL from .env
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }   // required by Supabase
});

module.exports = pool;
