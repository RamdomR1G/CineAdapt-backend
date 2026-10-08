const { pool } = require('../db');

// ── Watchlist ─────────────────────────────────────────────────────────────────

// GET /api/watchlist — lista personal del usuario autenticado
async function getWatchlist(req, res) {
  const result = await pool.query(
    `SELECT c.id, c.title, c.type, c.genre, c.poster_url,
            c.release_year, w.added_at
     FROM watchlist w
     JOIN content c ON c.id = w.content_id
     WHERE w.user_id = $1
     ORDER BY w.added_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
}

// POST /api/watchlist/:contentId — agregar a la lista
async function addToWatchlist(req, res) {
  const { contentId } = req.params;

  // Verificar que el contenido existe
  const content = await pool.query('SELECT id FROM content WHERE id = $1', [contentId]);
  if (content.rows.length === 0) {
    return res.status(404).json({ message: 'Contenido no encontrado.' });
  }

  try {
    await pool.query(
      'INSERT INTO watchlist (user_id, content_id) VALUES ($1, $2)',
      [req.user.id, contentId]
    );
    res.status(201).json({ message: 'Agregado a tu lista.' });
  } catch (e) {
    // Violacion de UNIQUE — ya esta en la lista
    if (e.code === '23505') {
      return res.status(409).json({ message: 'Ya esta en tu lista.' });
    }
    throw e;
  }
}

// DELETE /api/watchlist/:contentId — quitar de la lista
async function removeFromWatchlist(req, res) {
  await pool.query(
    'DELETE FROM watchlist WHERE user_id = $1 AND content_id = $2',
    [req.user.id, req.params.contentId]
  );
  res.json({ message: 'Eliminado de tu lista.' });
}

// ── Notificaciones ────────────────────────────────────────────────────────────

// GET /api/notifications — notificaciones del usuario (para movil y Wear OS)
async function getNotifications(req, res) {
  const result = await pool.query(
    `SELECT n.id, n.type, n.message, n.read, n.created_at,
            c.title AS content_title, c.poster_url
     FROM notifications n
     LEFT JOIN content c ON c.id = n.content_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT 50`,
    [req.user.id]
  );
  res.json(result.rows);
}

// PATCH /api/notifications/:id/read — marcar como leida
async function markAsRead(req, res) {
  await pool.query(
    'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  res.json({ message: 'Notificacion marcada como leida.' });
}

// POST /api/admin/notifications/broadcast — admin envia notificacion a todos
async function broadcast(req, res) {
  const { content_id, type, message } = req.body;

  if (!type || !message) {
    return res.status(400).json({ message: 'Tipo y mensaje son obligatorios.' });
  }

  // Obtener todos los usuarios con rol 'user'
  const users = await pool.query(`SELECT id FROM users WHERE role = 'user'`);

  if (users.rows.length === 0) {
    return res.json({ message: 'No hay usuarios registrados.' });
  }

  // Insertar una notificacion por usuario
  const values = users.rows.map((_, i) => {
    const base = i * 3;
    return `($${base + 1}, $${base + 2}, $${base + 3})`;
  }).join(', ');

  const params = users.rows.flatMap(u => [u.id, content_id || null, message]);
  // Agregar type al query de forma correcta
  await pool.query(
    `INSERT INTO notifications (user_id, content_id, message, type)
     SELECT u, c, m, $${params.length + 1}
     FROM (VALUES ${values}) AS t(u, c, m)`,
    [...params, type]
  );

  res.status(201).json({ message: `Notificacion enviada a ${users.rows.length} usuarios.` });
}

module.exports = {
  getWatchlist, addToWatchlist, removeFromWatchlist,
  getNotifications, markAsRead, broadcast,
};
