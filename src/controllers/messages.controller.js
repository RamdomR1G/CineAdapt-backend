const { pool } = require('../db/database');

const toId = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

// GET /api/users/lookup?email=... — busca a UNA persona por su correo exacto.
// Solo devuelve id y nombre; no existe un listado de usuarios.
async function lookupUser(req, res) {
  const { email } = req.query;
  if (typeof email !== 'string' || !email.trim())
    return res.status(400).json({ message: 'Escribe un correo.' });
  const { rows } = await pool.query('SELECT id, name FROM users WHERE lower(email) = lower($1)', [email.trim()]);
  if (!rows.length) return res.status(404).json({ message: 'No existe una cuenta con ese correo.' });
  if (rows[0].id === req.user.id) return res.status(400).json({ message: 'No puedes enviarte mensajes a ti mismo.' });
  res.json(rows[0]);
}

// POST /api/messages — recomendar un titulo o enviar un mensaje breve
async function sendMessage(req, res) {
  const { to_user_id, content_id, body } = req.body;
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) return res.status(400).json({ message: 'El mensaje no puede estar vacio.' });
  if (text.length > 280) return res.status(400).json({ message: 'El mensaje no puede pasar de 280 caracteres.' });

  const to = toId(to_user_id);
  if (!to) return res.status(400).json({ message: 'Destinatario invalido.' });
  if (to === req.user.id) return res.status(400).json({ message: 'No puedes enviarte mensajes a ti mismo.' });
  const dest = await pool.query('SELECT id FROM users WHERE id = $1', [to]);
  if (!dest.rows.length) return res.status(404).json({ message: 'Destinatario no encontrado.' });

  let cid = null;
  if (content_id !== undefined && content_id !== null) {
    cid = toId(content_id);
    if (!cid) return res.status(400).json({ message: 'Contenido invalido.' });
    const c = await pool.query('SELECT id FROM content WHERE id = $1', [cid]);
    if (!c.rows.length) return res.status(404).json({ message: 'Contenido no encontrado.' });
  }

  const { rows } = await pool.query(
    'INSERT INTO messages (from_user_id, to_user_id, content_id, body) VALUES ($1,$2,$3,$4) RETURNING id, created_at',
    [req.user.id, to, cid, text]);
  res.status(201).json({ message: 'Mensaje enviado.', ...rows[0] });
}

// GET /api/messages — recibidos, enviados y contadores
async function listMessages(req, res) {
  const base = `
    SELECT m.id, m.body, m.created_at, m.content_id, c.title AS content_title,
           fu.name AS from_name, tu.name AS to_name
    FROM messages m
    JOIN users fu ON fu.id = m.from_user_id
    JOIN users tu ON tu.id = m.to_user_id
    LEFT JOIN content c ON c.id = m.content_id`;
  const received = (await pool.query(base + ' WHERE m.to_user_id = $1 AND NOT m.hidden_receiver ORDER BY m.created_at DESC', [req.user.id])).rows;
  const sent     = (await pool.query(base + ' WHERE m.from_user_id = $1 AND NOT m.hidden_sender ORDER BY m.created_at DESC', [req.user.id])).rows;
  res.json({ received, sent, counts: { sent: sent.length, received: received.length } });
}

// DELETE /api/messages — limpia el historial de quien lo pide (el otro usuario conserva el suyo)
async function clearMessages(req, res) {
  await pool.query('UPDATE messages SET hidden_receiver = true WHERE to_user_id = $1', [req.user.id]);
  await pool.query('UPDATE messages SET hidden_sender = true WHERE from_user_id = $1', [req.user.id]);
  await pool.query('DELETE FROM messages WHERE hidden_sender AND hidden_receiver');
  res.json({ message: 'Historial limpiado.' });
}

module.exports = { lookupUser, sendMessage, listMessages, clearMessages };
