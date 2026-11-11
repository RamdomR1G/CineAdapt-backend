#!/usr/bin/env node
/**
 * Practica 11 - Fase 5A: ping y latencia de red (20 paquetes). Usa el comando ping del sistema (ICMP);
 * si no esta disponible o el servidor bloquea ICMP, mide el tiempo del saludo TCP (alternativa valida, NO equivalente a ICMP).
 *   node scripts/ping.js cineadapt-backend.onrender.com 443
 */
const { spawnSync } = require('child_process'); const net = require('net'); const fs = require('fs'); const { performance } = require('perf_hooks');
const host = process.argv[2]; const port = Number(process.argv[3] || 443); const N = 20;
if (!host) { console.error('Uso: node scripts/ping.js <host> [puerto]'); process.exit(1); }
const stats = (a) => { const m = a.reduce((t, v) => t + v, 0) / a.length; return { min: Math.min(...a), prom: m, max: Math.max(...a), desv: Math.sqrt(a.reduce((t, v) => t + (v - m) ** 2, 0) / a.length) }; };
const r2 = (x) => Math.round(x * 100) / 100;

function icmp() {
  const win = process.platform === 'win32';
  const r = spawnSync('ping', win ? ['-n', String(N), host] : ['-c', String(N), '-i', '0.2', host], { encoding: 'utf8', timeout: 60000 });
  if (r.error || !r.stdout) return null;
  const t = [...r.stdout.matchAll(/[=<]\s*(\d+(?:[.,]\d+)?)\s*ms/gi)].map((m) => parseFloat(m[1].replace(',', '.')));
  return t.length ? { metodo: 'ICMP (ping del sistema)', enviados: N, recibidos: t.length, tiempos: t } : { metodo: 'ICMP (sin respuestas)', enviados: N, recibidos: 0, tiempos: [] };
}
function tcp() {
  return new Promise(async (resolve) => {
    const t = []; for (let i = 0; i < N; i++) {
      await new Promise((ok) => { const t0 = performance.now(); const s = net.connect({ host, port, timeout: 3000 }, () => { t.push(performance.now() - t0); s.destroy(); ok(); }); s.on('error', () => ok()); s.on('timeout', () => { s.destroy(); ok(); }); });
    }
    resolve({ metodo: 'Saludo TCP al puerto ' + port + ' (alternativa: ICMP no disponible o bloqueado)', enviados: N, recibidos: t.length, tiempos: t });
  });
}
(async () => {
  let r = icmp(); if (!r || !r.recibidos) { const previo = r; r = await tcp(); r.nota = previo ? 'El servidor no respondio ICMP.' : 'El comando ping no esta disponible en este equipo.'; }
  const out = { fecha: new Date().toISOString(), host, ...r, perdida_pct: r2(((r.enviados - r.recibidos) / r.enviados) * 100), ...(r.tiempos.length ? Object.fromEntries(Object.entries(stats(r.tiempos)).map(([k, v]) => [k, r2(v)])) : {}) };
  delete out.tiempos; fs.mkdirSync('evidencias', { recursive: true }); fs.writeFileSync('evidencias/ping.json', JSON.stringify(out, null, 2)); console.log(out);
})();
