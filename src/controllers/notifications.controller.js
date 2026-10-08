const { pool } = require('../db/database');

// Obtener notificaciones del usuario autenticado
async function getNotifications(req, res) {
  const { rows } = await pool.query(
    `SELECT n.*, c.title as content_title, c.poster_url
     FROM notifications n
     LEFT JOIN content c ON c.id = n.content_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT 50`,
    [req.user.id]
  );
  res.json(rows);
}

// Marcar una notificacion como leida
async function markRead(req, res) {
  await pool.query(
    'UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id]
  );
  res.json({ message: 'Marcada como leida.' });
}

// Marcar todas como leidas
async function markAllRead(req, res) {
  await pool.query(
    'UPDATE notifications SET read=true WHERE user_id=$1',
    [req.user.id]
  );
  res.json({ message: 'Todas marcadas como leidas.' });
}

// Cuantas notificaciones sin leer tiene el usuario (para el badge del movil)
async function unreadCount(req, res) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id=$1 AND read=false',
    [req.user.id]
  );
  res.json({ count: parseInt(rows[0].count) });
}

module.exports = { getNotifications, markRead, markAllRead, unreadCount };
