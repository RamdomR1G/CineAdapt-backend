const { pool } = require('../db/database');

async function getWatchlist(req, res) {
  const { rows } = await pool.query(
    `SELECT c.*, w.added_at
     FROM watchlist w
     JOIN content c ON c.id = w.content_id
     WHERE w.user_id = $1
     ORDER BY w.added_at DESC`,
    [req.user.id]
  );
  res.json(rows);
}

async function addToWatchlist(req, res) {
  const { content_id } = req.body;
  if (!content_id) return res.status(400).json({ message: 'content_id requerido.' });

  try {
    const { rows } = await pool.query(
      'INSERT INTO watchlist (user_id, content_id) VALUES ($1,$2) RETURNING *',
      [req.user.id, content_id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'Ya esta en tu lista.' });
    throw e;
  }
}

async function removeFromWatchlist(req, res) {
  const { rows } = await pool.query(
    'DELETE FROM watchlist WHERE user_id=$1 AND content_id=$2 RETURNING id',
    [req.user.id, req.params.content_id]
  );
  if (!rows.length) return res.status(404).json({ message: 'No encontrado en tu lista.' });
  res.json({ message: 'Eliminado de tu lista.' });
}

module.exports = { getWatchlist, addToWatchlist, removeFromWatchlist };
