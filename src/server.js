require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors    = require('cors');
const { initDb } = require('./db/database');
const routes  = require('./routes');

const app  = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [
  'http://localhost:3000', 
  'http://localhost:4000',
  'http://localhost:4200',
  'http://localhost:4300',
  'http://localhost:3001',
  'null',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('CORS bloqueado'));
  },
  credentials: true,
}));

app.use(express.json());
app.use('/api', routes);

app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date() }));

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  const status = err.status || 500;
  res.status(status).json({ message: err.message || 'Error interno del servidor.' });
});

(async () => {
  await initDb();
  app.listen(PORT, () => console.log(`Backend corriendo en http://localhost:${PORT}`));
})();
