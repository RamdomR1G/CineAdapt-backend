// Practica 11: demuestra que bcryptjs (JavaScript puro) bloquea el hilo principal de Node mientras procesa inicios de sesion.
// Mide el tiempo de /health (que no usa BD) mientras otros 5 clientes inician sesion al mismo tiempo.
const base = process.argv[2] || 'http://localhost:4100', email = process.argv[3], pass = process.argv[4];
const t = async (f) => { const t0 = performance.now(); await f(); return Math.round((performance.now() - t0) * 10) / 10; };
const login = () => fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) }).then((r) => r.text());
const health = () => fetch(base + '/health').then((r) => r.text());
(async () => {
  await login();
  const solo = []; for (let i = 0; i < 10; i++) solo.push(await t(health));
  const unLogin = []; for (let i = 0; i < 5; i++) unLogin.push(await t(login));
  const durante = []; const logins = Array.from({ length: 5 }, () => t(login));
  await new Promise((r) => setTimeout(r, 5)); for (let i = 0; i < 8; i++) durante.push(await t(health));
  const totales = await Promise.all(logins);
  const med = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;
  const r = { health_en_reposo_ms: { prom: med(solo), max: Math.max(...solo) }, un_login_ms: med(unLogin), health_con_5_logins_simultaneos_ms: { prom: med(durante), max: Math.max(...durante) }, logins_simultaneos_ms: totales };
  console.log(JSON.stringify(r, null, 2)); require('fs').mkdirSync('evidencias', { recursive: true }); require('fs').writeFileSync('evidencias/bloqueo-hilo.json', JSON.stringify(r, null, 2));
})();
