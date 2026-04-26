require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.evolution') });

var mysql = require('mysql2/promise');

var pool = mysql.createPool({
  host:             process.env.APP_DB_HOST     || '127.0.0.1',
  port:             Number(process.env.APP_DB_PORT || 3306),
  user:             process.env.APP_DB_USER     || 'evolution_user',
  password:         process.env.APP_DB_PASSWORD,
  database:         process.env.APP_DB_NAME     || 'evolution_db',
  waitForConnections: true,
  connectionLimit:  5,
  timezone:         '-03:00'
});

module.exports = pool;
