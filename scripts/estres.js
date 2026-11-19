#!/usr/bin/env node
/**
 * Practica 12 - Fase 3: prueba de estres reproducible (sin dependencias externas, Node 18+).
 *   node scripts/estres.js <urlBase> <etiqueta> [--pid N] [--seg 6] [--lectura "/content?status=published"]
 * Escenarios: lectura (GET), escritura (POST /reports) y login (POST /auth/login, usa bcrypt).
 * Por cada nivel de usuarios concurrentes (1, 5, 10, 25, 50) mide durante --seg segundos:
 *   RPS, promedio, P50/P90/P95/P99, maximo, % de errores, codigos HTTP, bytes por respuesta (en la red)
 *   y, si se da --pid, CPU (%) y memoria RSS (MB) del proceso del servidor (/proc, solo Linux).
 * Salida: evidencias/estres-<etiqueta>.json
 */
const http = require('http'); const https = require('https'); const zlib = require('zlib'); const fs = require('fs'); const os = require('os');
const { performance } = require('perf_hooks');
const argv = process.argv.slice(2); const base = argv[0]; const tag = argv[1];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i > -1 ? argv[i + 1] : d; };
if (!base || !tag) { console.error('Uso: node scripts/estres.js <urlBase> <etiqueta> [--pid N] [--seg 6] [--lectura "/content?status=published"]'); process.exit(1); }
const SEG = Number(opt('seg', 6)); const PID = opt('pid'); const LECTURA = opt('lectura', '/content?status=published');
const NIVELES = (opt('niveles', '1,5,10,25,50')).split(',').map(Number);
const u = new URL(base); const lib = u.protocol === 'https:' ? https : http;
const agent = new lib.Agent({ keepAlive: true, maxSockets: 200 });
const r2 = (x) => Math.round(x * 100) / 100;

function pedir(metodo, ruta, { token, body } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now(); const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = lib.request({ agent, hostname: u.hostname, port: u.port, path: '/api' + ruta, method: metodo, timeout: 30000,
      headers: { 'Accept-Encoding': 'gzip', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) } }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c));
      res.on('end', () => { const raw = Buffer.concat(parts); let txt = raw;
        try { if (res.headers['content-encoding'] === 'gzip') txt = zlib.gunzipSync(raw); } catch {}
        resolve({ status: res.statusCode, ms: performance.now() - t0, bytes: raw.length, plano: txt.length, body: txt.toString() }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ms: performance.now() - t0, bytes: 0, plano: 0, error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, ms: performance.now() - t0, bytes: 0, plano: 0, error: e.code || e.message }));
    if (data) req.write(data); req.end();
  });
}
const hz = Number(require('child_process').execSync('getconf CLK_TCK').toString());
const cpuT = () => { const s = fs.readFileSync(`/proc/${PID}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(s[11]) + Number(s[12])) / hz; };
const rssMB = () => Number(fs.readFileSync(`/proc/${PID}/statm`, 'utf8').split(' ')[1]) * 4096 / 2 ** 20;
const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)] : 0;

async function nivel(c, fn) {
  const lat = []; const codes = {}; let bytes = 0, plano = 0, errores = 0; const fin = performance.now() + SEG * 1000; const t0 = performance.now();
  const muestras = []; let cpu0 = PID ? cpuT() : 0; let tPrev = performance.now(); const memMax = { v: PID ? rssMB() : 0 };
  const mon = PID ? setInterval(() => { const t = cpuT(), n = performance.now(); muestras.push(((t - cpu0) / ((n - tPrev) / 1000)) * 100); cpu0 = t; tPrev = n; memMax.v = Math.max(memMax.v, rssMB()); }, 500) : null;
  await Promise.all(Array.from({ length: c }, async () => { while (performance.now() < fin) {
    const r = await fn(); codes[r.status] = (codes[r.status] || 0) + 1; if (!(r.status >= 200 && r.status < 300)) errores++; else { lat.push(r.ms); bytes += r.bytes; plano += r.plano; } } }));
  if (mon) clearInterval(mon); const dur = (performance.now() - t0) / 1000; const total = Object.values(codes).reduce((a, b) => a + b, 0); lat.sort((a, b) => a - b);
  return { usuarios: c, solicitudes: total, exitosas: lat.length, errores, errores_pct: r2((errores / total) * 100), codigos: codes, rps: r2(total / dur),
    prom_ms: r2(lat.reduce((a, b) => a + b, 0) / (lat.length || 1)), p50_ms: r2(q(lat, 0.5)), p90_ms: r2(q(lat, 0.9)), p95_ms: r2(q(lat, 0.95)), p99_ms: r2(q(lat, 0.99)), max_ms: r2(lat[lat.length - 1] || 0),
    bytes_red_por_resp: lat.length ? Math.round(bytes / lat.length) : 0, bytes_sin_comprimir: lat.length ? Math.round(plano / lat.length) : 0,
    ...(PID ? { cpu_prom_pct: r2(muestras.reduce((a, b) => a + b, 0) / (muestras.length || 1)), cpu_max_pct: r2(Math.max(0, ...muestras)), rss_max_mb: r2(memMax.v) } : {}) };
}

(async () => {
  const email = 'estres@wb.test', password = 'Estres-2026!';
  await pedir('POST', '/auth/register', { body: { name: 'Usuario estres', email, password } });
  const lg = await pedir('POST', '/auth/login', { body: { email, password } });
  if (lg.status !== 200) { console.error('Login fallido: HTTP ' + lg.status, lg.body); process.exit(2); }
  const token = JSON.parse(lg.body).token;
  await pedir('GET', LECTURA, { token }); // calentamiento descartado
  const out = { etiqueta: tag, fecha: new Date().toISOString(), servidor: base, segundos_por_nivel: SEG, lectura: LECTURA,
    equipo: { cpu: os.cpus()[0].model, nucleos: os.cpus().length, ram_gb: r2(os.totalmem() / 2 ** 30), node: process.version }, lectura_res: [], escritura_res: [], login_res: [] };
  for (const c of NIVELES) { out.lectura_res.push(await nivel(c, () => pedir('GET', LECTURA, { token }))); console.log('lectura', c, out.lectura_res.at(-1).rps, 'rps', out.lectura_res.at(-1).p95_ms, 'p95'); }
  let n = 0; for (const c of NIVELES) { out.escritura_res.push(await nivel(c, () => pedir('POST', '/reports', { token, body: { title: 'Estres ' + (++n), description: 'prueba de estres', priority: 'Baja' } }))); console.log('escritura', c, out.escritura_res.at(-1).rps, 'rps', out.escritura_res.at(-1).p95_ms, 'p95'); }
  for (const c of [1, 5, 10]) { out.login_res.push(await nivel(c, () => pedir('POST', '/auth/login', { body: { email, password } }))); console.log('login', c, out.login_res.at(-1).rps, 'rps', out.login_res.at(-1).p95_ms, 'p95'); }
  fs.mkdirSync('evidencias', { recursive: true }); fs.writeFileSync(`evidencias/estres-${tag}.json`, JSON.stringify(out, null, 2)); agent.destroy();
})();
