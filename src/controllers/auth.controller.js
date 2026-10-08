const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { pool } = require('../db/database');

async function register(req, res) {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ message: 'Todos los campos son obligatorios.' });
  if (password.length < 6)
    return res.status(400).json({ message: 'La contrasena debe tener minimo 6 caracteres.' });

  const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (exists.rows.length)
    return res.status(409).json({ message: 'El correo ya esta registrado.' });

  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id, name, email, role',
    [name, email, hash]
  );

  res.status(201).json({ message: 'Cuenta creada.', user: rows[0] });
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: 'Email y contrasena requeridos.' });

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!rows.length)
    return res.status(401).json({ message: 'Credenciales incorrectas.' });

  const user = rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match)
    return res.status(401).json({ message: 'Credenciales incorrectas.' });

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}

async function me(req, res) {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Usuario no encontrado.' });
  res.json(rows[0]);
}

module.exports = { register, login, me };
