const { pool, initDb } = require('../../src/db/database');
async function prepararBD() { await initDb(); }
async function limpiarBD() {
  await pool.query('TRUNCATE users, content, watchlist, notifications, reports, messages RESTART IDENTITY CASCADE');
}
async function cerrarBD() { await pool.end(); }
module.exports = { pool, prepararBD, limpiarBD, cerrarBD };
