#!/usr/bin/env node
/**
 * Practica 11 - Fase 5: mediciones de conectividad y rendimiento (HTTP). Ejecutar en el equipo del alumno:
 *   node scripts/medir.js https://cineadapt-backend.onrender.com correo@dominio.com contrasena
 *   node scripts/medir.js http://localhost:4000 correo@dominio.com contrasena
 * No usa dependencias externas (Node 18+). Guarda evidencias/mediciones.json y evidencias/mediciones.csv
 */
const fs = require('fs'); const os = require('os'); const path = require('path'); const { performance } = require('perf_hooks');
const [base, email, password] = process.argv.slice(2);
if (!base || !email || !password) { console.error('Uso: node scripts/medir.js <urlBase> <correo> <contrasena>'); process.exit(1); }
const API = base.replace(/\/$/, '') + '/api';
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const m = a.reduce((t, v) => t + v, 0) / a.length;
  const sd = Math.sqrt(a.reduce((t, v) => t + (v - m) ** 2, 0) / a.length); const p = (q) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
  return { n: a.length, min: s[0], max: s[s.length - 1], prom: m, desv: sd, p50: p(0.5), p95: p(0.95) }; };
const r2 = (x) => Math.round(x * 100) / 100;

async function pedir(metodo, ruta, { token, body } = {}) {
  const t0 = performance.now();
  const res = await fetch(API + ruta, { method: metodo, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer()); const ms = performance.now() - t0;
  return { status: res.status, ms, bytes: buf.length };
}
async function ola(n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < TOTAL) { const k = i++; out.push(await fn(k)); } })); return out; }
let TOTAL = 0;
async function carga(concurrencia, total, fn) {
  TOTAL = total; const t0 = performance.now(); const res = []; let i = 0;
  await Promise.all(Array.from({ length: concurrencia }, async () => { while (i < total) { i++; try { res.push(await fn()); } catch (e) { res.push({ status: 0, ms: 0, bytes: 0 }); } } }));
  const dur = (performance.now() - t0) / 1000; const ok = res.filter((x) => x.status >= 200 && x.status < 300);
  const bytes = res.reduce((t, x) => t + x.bytes, 0);
  return { concurrencia, total, ok: ok.length, fallidas: res.length - ok.length, seg: r2(dur), rps: r2(res.length / dur), mbps: r2((bytes * 8) / dur / 1e6), ...Object.fromEntries(Object.entries(stats(ok.map((x) => x.ms))).map(([k, v]) => [k, r2(v)])) };
}

(async () => {
  const out = { fecha: new Date().toISOString(), equipo: { so: os.type() + ' ' + os.release(), cpu: os.cpus()[0].model, nucleos: os.cpus().length, ram_gb: r2(os.totalmem() / 2 ** 30), node: process.version }, servidor: base };
  const login = await pedir('POST', '/auth/login', { body: { email, password } });
  if (login.status !== 200) { console.error('Login fallido: HTTP ' + login.status); process.exit(2); }
  const token = JSON.parse(await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).text()).token;

  // B/D. 10 solicitudes consecutivas al mismo endpoint (GET /content) + calentamiento descartado
  await pedir('GET', '/content?status=published', { token });
  out.diez = []; for (let i = 1; i <= 10; i++) out.diez.push({ n: i, ...(await pedir('GET', '/content?status=published', { token })) });
  out.latencia_http = Object.fromEntries(Object.entries(stats(out.diez.map((x) => x.ms))).map(([k, v]) => [k, r2(v)]));
  // C. tasa de descarga: 3 mediciones
  out.descarga = []; for (let i = 0; i < 3; i++) { const r = await pedir('GET', '/content?status=published', { token }); out.descarga.push({ ms: r2(r.ms), bytes: r.bytes, mbps: r2((r.bytes * 8) / (r.ms / 1000) / 1e6) }); }
  // C. tasa de subida: 3 mediciones (POST de cuerpo conocido; si el endpoint rechaza, igual se mide el envio)
  const carga1k = { title: 'Prueba de subida', description: 'x'.repeat(1900), priority: 'Baja' };
  const bytesSubida = Buffer.byteLength(JSON.stringify(carga1k));
  out.subida = []; for (let i = 0; i < 3; i++) { const r = await pedir('POST', '/reports', { token, body: carga1k }); out.subida.push({ status: r.status, ms: r2(r.ms), bytes_enviados: bytesSubida, mbps: r2((bytesSubida * 8) / (r.ms / 1000) / 1e6) }); }
  // Carga controlada: lectura (GET /content) y escritura (POST /reports), 1/5/10 usuarios, 20 solicitudes minimo
  out.carga_lectura = []; for (const c of [1, 5, 10]) out.carga_lectura.push(await carga(c, 40, () => pedir('GET', '/content?status=published', { token })));
  out.carga_escritura = []; for (const c of [1, 5, 10]) out.carga_escritura.push(await carga(c, 20, () => pedir('POST', '/reports', { token, body: { title: 'Carga ' + Date.now(), description: 'prueba de carga', priority: 'Baja' } })));
  fs.mkdirSync('evidencias', { recursive: true });
  fs.writeFileSync(path.join('evidencias', 'mediciones.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join('evidencias', 'mediciones.csv'), 'solicitud,codigo_http,tiempo_ms,tamano_bytes\n' + out.diez.map((x) => [x.n, x.status, r2(x.ms), x.bytes].join(',')).join('\n') + '\n');
  console.log(JSON.stringify({ latencia_http: out.latencia_http, diez: out.diez.length, carga_lectura: out.carga_lectura, carga_escritura: out.carga_escritura }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
