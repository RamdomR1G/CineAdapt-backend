require('dotenv').config();

const app = require('./app');
const { initDb } = require('./db/database');

const PORT = process.env.PORT || 4000;

(async () => {
  await initDb();
  app.listen(PORT, () => console.log(`Backend corriendo en http://localhost:${PORT}`));
})();
