#!/usr/bin/env node
/** Resume un .cpuprofile de Node: tiempo propio (ms) por funcion y por categoria. Uso: node scripts/perfil-cpu.js archivo.cpuprofile salida.json */
const fs = require('fs'); const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const self = new Map(); const byId = new Map(p.nodes.map((n) => [n.id, n]));
p.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (p.timeDeltas[i] || 0)));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const cat = (n) => { const u = n.callFrame.url || '', f = n.callFrame.functionName || '';
  if (/bcryptjs|bcrypt/.test(u)) return 'bcrypt'; if (/node_modules\/pg\//.test(u)) return 'pg (base de datos)'; if (f === '(idle)') return 'inactivo (idle)'; if (f === '(garbage collector)') return 'recoleccion de basura';
  if (f === 'stringify' || /JSON/.test(f)) return 'JSON.stringify'; if (/node_modules\/express|node_modules\/body-parser|node_modules\/compression/.test(u)) return 'express / middleware'; if (/node:|^$/.test(u)) return 'nucleo de Node / nativo'; return 'codigo de la aplicacion y otros'; };
const porCat = {}; const fn = new Map();
for (const [id, us] of self) { const n = byId.get(id); const c = cat(n); porCat[c] = (porCat[c] || 0) + us; const k = (n.callFrame.functionName || '(anonima)') + ' ' + (n.callFrame.url || '').split('/').slice(-2).join('/') + ':' + n.callFrame.lineNumber; fn.set(k, (fn.get(k) || 0) + us); }
const r = (x) => Math.round(x / 100) / 10;
const activo = total - (porCat['inactivo (idle)'] || 0);
const out = { duracion_ms: r(total), activo_ms: r(activo), por_categoria: Object.fromEntries(Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { ms: r(v), pct_del_tiempo_activo: k.startsWith('inactivo') ? null : Math.round((v / activo) * 1000) / 10 }])),
  top_funciones: [...fn].filter(([k]) => !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ funcion: k, ms: r(v) })) };
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1));
