require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.evolution'), override: true });

var mysql = require('mysql2/promise');

// Pool criado com funcao para garantir que process.env ja foi carregado
function criarPool() {
  return mysql.createPool({
    host:             process.env.APP_DB_HOST     || '127.0.0.1',
    port:             Number(process.env.APP_DB_PORT || 3306),
    user:             process.env.APP_DB_USER     || 'evolution_user',
    password:         process.env.APP_DB_PASSWORD,
    database:         process.env.APP_DB_NAME     || 'evolution_db',
    waitForConnections: true,
    connectionLimit:  5,
    timezone:         '-03:00'
  });
}

var pool = null;

module.exports = {
  execute: function() {
    if (!pool) pool = criarPool();
    return pool.execute.apply(pool, arguments);
  },
  query: function() {
    if (!pool) pool = criarPool();
    return pool.query.apply(pool, arguments);
  },
  getConnection: function() {
    if (!pool) pool = criarPool();
    return pool.getConnection.apply(pool, arguments);
  }
};
