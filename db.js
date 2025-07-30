const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'oaktowntechnology.c76gg4wwio3z.us-east-1.rds.amazonaws.com', // RDS endpoint
  user: 'admin', // Your RDS master username
  password: 'oaktowntechnology',    // Your RDS password
  database: 'oaktowntech', // The database name (create one if not already)
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;

