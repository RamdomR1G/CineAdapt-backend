// Hash de contrasenas. Usa la libreria nativa "bcrypt" (se ejecuta en el pool de hilos de libuv y no bloquea el
// hilo principal de Node). Si no se puede cargar, cae en "bcryptjs" (JavaScript puro). Ambas generan hashes $2b$ compatibles.
let impl, nativo = true;
try { impl = require('bcrypt'); } catch { impl = require('bcryptjs'); nativo = false; }
module.exports = { hash: (p, rondas) => impl.hash(p, rondas), compare: (p, h) => impl.compare(p, h), nativo };
