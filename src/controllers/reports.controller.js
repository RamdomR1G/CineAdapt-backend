const { pool } = require('../db/database');
const { uploadBuffer } = require('../services/cloudinary');

const PRIORITIES = ['Baja', 'Media', 'Alta', 'Crítica'];
const STATUSES   = ['Abierto', 'En proceso', 'Resuelto'];

const toId = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

const SELECT = `
  SELECT r.*, u.name AS created_by_name, a.name AS assigned_to_name
  FROM reports r
  JOIN users u ON u.id = r.created_by
  LEFT JOIN users a ON a.id = r.assigned_to`;

// Quien puede ver un reporte: admin (todos), su creador, o el agente asignado
function canView(user, r) {
  return user.role === 'admin' || r.created_by === user.id ||
         (user.role === 'agent' && r.assigned_to === user.id);
}

function validateTitle(v)       { return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 150; }
function validateDescription(v) { return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 2000; }

// POST /api/reports — el dueno SIEMPRE sale del token, nunca del cuerpo de la peticion
async function createReport(req, res) {
  const { title, description, priority = 'Media' } = req.body;
  if (!validateTitle(title) || !validateDescription(description))
    return res.status(400).json({ message: 'Titulo (max. 150) y descripcion (max. 2000) son obligatorios.' });
  if (!PRIORITIES.includes(priority))
    return res.status(400).json({ message: 'Prioridad invalida.' });

  let attachment_url = null;
  if (req.file) {
    const r = await uploadBuffer(req.file.buffer, 'cineadapt/reports', 'image');
    attachment_url = r.secure_url;
  }

  const ins = await pool.query(
    `INSERT INTO reports (title, description, priority, created_by, attachment_url)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [title.trim(), description.trim(), priority, req.user.id, attachment_url]);
  const id = ins.rows[0].id;
  // El identificador lo asigna el servidor (REP001, REP002...), por lo que nunca se repite
  await pool.query('UPDATE reports SET code = $1 WHERE id = $2', ['REP' + String(id).padStart(3, '0'), id]);
  const { rows } = await pool.query(SELECT + ' WHERE r.id = $1', [id]);
  res.status(201).json(rows[0]);
}

// GET /api/reports — cada rol ve solo lo que le corresponde
async function listReports(req, res) {
  const { role, id } = req.user;
  const params = [];
  let where = '';
  if (role === 'agent')      { where = 'WHERE r.assigned_to = $1'; params.push(id); }
  else if (role !== 'admin') { where = 'WHERE r.created_by = $1';  params.push(id); }
  if (req.query.status) {
    if (!STATUSES.includes(req.query.status)) return res.status(400).json({ message: 'Estado invalido.' });
    params.push(req.query.status);
    where += (where ? ' AND' : 'WHERE') + ` r.status = $${params.length}`;
  }
  const { rows } = await pool.query(SELECT + ` ${where} ORDER BY r.created_at DESC`, params);
  res.json(rows);
}

// GET /api/reports/:id
async function getReport(req, res) {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Identificador invalido.' });
  const { rows } = await pool.query(SELECT + ' WHERE r.id = $1', [id]);
  if (!rows.length) return res.status(404).json({ message: 'Reporte no encontrado.' });
  if (!canView(req.user, rows[0])) return res.status(403).json({ message: 'No tienes acceso a este reporte.' });
  res.json(rows[0]);
}

// PUT /api/reports/:id — los campos permitidos dependen del rol
async function updateReport(req, res) {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Identificador invalido.' });
  const found = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
  if (!found.rows.length) return res.status(404).json({ message: 'Reporte no encontrado.' });
  const r = found.rows[0];
  if (!canView(req.user, r)) return res.status(403).json({ message: 'No tienes acceso a este reporte.' });

  const isOwner = r.created_by === req.user.id;
  const isStaff = req.user.role === 'admin' || (req.user.role === 'agent' && r.assigned_to === req.user.id);
  const allowed = new Set();
  if (isOwner) ['title', 'description', 'priority'].forEach(f => allowed.add(f));
  if (isStaff) ['status', 'priority'].forEach(f => allowed.add(f));
  if (req.user.role === 'admin') ['title', 'description'].forEach(f => allowed.add(f));

  const { version, ...changes } = req.body;
  const keys = Object.keys(changes);
  if (!keys.length) return res.status(400).json({ message: 'No hay cambios.' });
  const forbidden = keys.find(k => !allowed.has(k));
  if (forbidden) return res.status(403).json({ message: `No puedes modificar el campo ${forbidden}.` });

  if ('title' in changes && !validateTitle(changes.title)) return res.status(400).json({ message: 'Titulo invalido.' });
  if ('description' in changes && !validateDescription(changes.description)) return res.status(400).json({ message: 'Descripcion invalida.' });
  if ('priority' in changes && !PRIORITIES.includes(changes.priority)) return res.status(400).json({ message: 'Prioridad invalida.' });
  if ('status' in changes && !STATUSES.includes(changes.status)) return res.status(400).json({ message: 'Estado invalido.' });

  // Control de conflictos: si el cliente manda la version que vio y ya cambio, se rechaza
  const params = [];
  const sets = keys.map(k => { params.push(typeof changes[k] === 'string' ? changes[k].trim() : changes[k]); return `${k} = $${params.length}`; });
  params.push(id);
  let where = `id = $${params.length}`;
  if (version !== undefined) { params.push(Number(version)); where += ` AND version = $${params.length}`; }
  const upd = await pool.query(
    `UPDATE reports SET ${sets.join(', ')}, version = version + 1, updated_at = NOW() WHERE ${where} RETURNING id`, params);
  if (!upd.rows.length)
    return res.status(409).json({ message: 'El reporte fue modificado por otra persona. Vuelve a consultarlo.' });
  const { rows } = await pool.query(SELECT + ' WHERE r.id = $1', [id]);
  res.json(rows[0]);
}

// PUT /api/reports/:id/assign — solo administrador
async function assignReport(req, res) {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Identificador invalido.' });
  const agentId = req.body.agent_id === null ? null : toId(req.body.agent_id);
  if (req.body.agent_id !== null && !agentId) return res.status(400).json({ message: 'agent_id invalido.' });
  if (agentId) {
    const a = await pool.query("SELECT id FROM users WHERE id = $1 AND role = 'agent'", [agentId]);
    if (!a.rows.length) return res.status(400).json({ message: 'El usuario indicado no es agente de atencion.' });
  }
  const upd = await pool.query(
    `UPDATE reports SET assigned_to = $1,
       status = CASE WHEN $1::int IS NOT NULL AND status = 'Abierto' THEN 'En proceso' ELSE status END,
       version = version + 1, updated_at = NOW()
     WHERE id = $2 RETURNING id`, [agentId, id]);
  if (!upd.rows.length) return res.status(404).json({ message: 'Reporte no encontrado.' });
  const { rows } = await pool.query(SELECT + ' WHERE r.id = $1', [id]);
  res.json(rows[0]);
}

// DELETE /api/reports/:id — su creador o el administrador
async function deleteReport(req, res) {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Identificador invalido.' });
  const found = await pool.query('SELECT created_by FROM reports WHERE id = $1', [id]);
  if (!found.rows.length) return res.status(404).json({ message: 'Reporte no encontrado.' });
  if (req.user.role !== 'admin' && found.rows[0].created_by !== req.user.id)
    return res.status(403).json({ message: 'No puedes eliminar este reporte.' });
  await pool.query('DELETE FROM reports WHERE id = $1', [id]);
  res.json({ message: 'Reporte eliminado.' });
}

// GET /api/agents — solo administrador, para elegir a quien asignar
async function listAgents(req, res) {
  const { rows } = await pool.query("SELECT id, name, email FROM users WHERE role = 'agent' ORDER BY name");
  res.json(rows);
}

// PUT /api/admin/users/role — el administrador convierte una cuenta en agente (o la regresa a usuario)
async function setUserRole(req, res) {
  const { email, role } = req.body;
  if (typeof email !== 'string' || !['user', 'agent'].includes(role))
    return res.status(400).json({ message: 'Correo y rol (user o agent) son obligatorios.' });
  const u = await pool.query('SELECT id, role FROM users WHERE lower(email) = lower($1)', [email]);
  if (!u.rows.length) return res.status(404).json({ message: 'Usuario no encontrado.' });
  if (u.rows[0].role === 'admin') return res.status(403).json({ message: 'No se puede cambiar el rol de un administrador.' });
  const { rows } = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role', [role, u.rows[0].id]);
  res.json(rows[0]);
}

module.exports = { createReport, listReports, getReport, updateReport, assignReport, deleteReport, listAgents, setUserRole };
