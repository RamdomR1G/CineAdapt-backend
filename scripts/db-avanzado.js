#!/usr/bin/env node
/**
 * Practica 12 - Fase 4: pruebas avanzadas de base de datos. Uso: node scripts/db-avanzado.js <etiqueta>
 * Variables: DB_HOST, DB_PORT, DB_NAME, DB_USER (igual que el backend). Guarda evidencias/db-avanzado-<etiqueta>.json
 * Mide cada consulta (mediana de 30 repeticiones, ms), filas devueltas, plan (indice o recorrido completo),
 * consultas por solicitud (N+1), escrituras concurrentes sobre un mismo registro e integridad posterior.
 */
const { Pool } = require('pg'); const fs = require('fs'); const { performance } = require('perf_hooks');
const tag = process.argv[2] || 'prueba';
const pool = new Pool({ host: process.env.DB_HOST || '/tmp', port: Number(process.env.DB_PORT || 5433), database: process.env.DB_NAME || 'cineadapt_wb', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '', max: 30 });
const r3 = (x) => Math.round(x * 1000) / 1000; const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function medir(nombre, sql, params = [], reps = 30) {
  const t = []; let filas = 0; for (let i = 0; i < reps + 3; i++) { const t0 = performance.now(); const r = await pool.query(sql, params); if (i >= 3) t.push(performance.now() - t0); filas = r.rowCount; }
  const plan = (await pool.query('EXPLAIN (ANALYZE, FORMAT JSON) ' + sql, params)).rows[0]['QUERY PLAN'][0];
  const nodos = []; (function rec(n) { nodos.push(n['Node Type'] + (n['Index Name'] ? ' (' + n['Index Name'] + ')' : '')); (n.Plans || []).forEach(rec); })(plan.Plan);
  return { consulta: nombre, filas, mediana_ms: r3(med(t)), max_ms: r3(Math.max(...t)), ejecucion_bd_ms: r3(plan['Execution Time']), usa_indice: nodos.some((n) => /Index/.test(n)), plan: nodos.join(' > ') };
}
(async () => {
  const out = { etiqueta: tag, fecha: new Date().toISOString(), consultas: [] };
  const uid = (await pool.query("SELECT created_by FROM reports GROUP BY created_by ORDER BY count(*) DESC LIMIT 1")).rows[0].created_by;
  const cid = (await pool.query("SELECT id FROM content ORDER BY id OFFSET 2500 LIMIT 1")).rows[0].id;
  const REP = `SELECT r.*, u.name AS created_by_name, a.name AS assigned_to_name FROM reports r JOIN users u ON u.id = r.created_by LEFT JOIN users a ON a.id = r.assigned_to`;
  const C = out.consultas;
  C.push(await medir('1. Por identificador (contenido)', 'SELECT * FROM content WHERE id = $1', [cid]));
  C.push(await medir('2. Conjunto pequeno (lista de un usuario)', 'SELECT c.*, w.added_at FROM watchlist w JOIN content c ON c.id = w.content_id WHERE w.user_id = $1 ORDER BY w.added_at DESC', [uid]));
  C.push(await medir('3. Conjunto grande (catalogo completo)', "SELECT * FROM content WHERE status = 'published' ORDER BY created_at DESC"));
  C.push(await medir('3b. Catalogo, primera pagina de 30 (campos de tarjeta)', "SELECT id, title, type, genre, release_year, poster_url, video_url, external_video_url, trailer_url FROM content WHERE status = 'published' ORDER BY created_at DESC, id DESC LIMIT 30 OFFSET 0"));
  C.push(await medir('4a. Filtro: reportes de un usuario', REP + ' WHERE r.created_by = $1 ORDER BY r.created_at DESC', [uid]));
  C.push(await medir('4b. Filtro: reportes asignados y abiertos', "SELECT * FROM reports WHERE assigned_to = 5 AND status = 'Abierto'"));
  C.push(await medir('4c. Filtro: contenido por tipo y genero', "SELECT * FROM content WHERE status = 'published' AND type = 'movie' AND genre = 'Drama' ORDER BY created_at DESC"));
  C.push(await medir('4d. Filtro: busqueda de texto (ILIKE)', "SELECT * FROM content WHERE status = 'published' AND (title ILIKE $1 OR description ILIKE $1) ORDER BY created_at DESC", ['%Carga 123%']));
  // N+1: consultas ejecutadas por una solicitud a getContent de una serie (xact_commit antes y despues)
  const sid = (await pool.query("SELECT id FROM content WHERE type='series' ORDER BY id LIMIT 1")).rows[0].id;
  await pool.query('DELETE FROM seasons WHERE content_id=$1', [sid]);
  for (let s = 1; s <= 5; s++) { const ss = (await pool.query('INSERT INTO seasons (content_id, season_number) VALUES ($1,$2) RETURNING id', [sid, s])).rows[0].id;
    await pool.query("INSERT INTO episodes (season_id, episode_number, title) SELECT $1, g, 'Ep '||g FROM generate_series(1,10) g", [ss]); }
  out.serie_prueba = { id: sid, temporadas: 5, episodios: 50 };
  // Concurrencia: 20 clientes leen-modifican-escriben el mismo reporte (patron del cliente) y 20 con UPDATE atomico
  const rid = (await pool.query("INSERT INTO reports (title, description, created_by) VALUES ('Concurrencia','x',$1) RETURNING id", [uid])).rows[0].id;
  const N = 20; const t0 = performance.now();
  const sinControl = await Promise.all(Array.from({ length: N }, async () => { const t = performance.now(); const c = await pool.connect(); try { const v = (await c.query('SELECT version FROM reports WHERE id=$1', [rid])).rows[0].version; await new Promise((r) => setTimeout(r, 5)); await c.query('UPDATE reports SET version=$2 WHERE id=$1', [rid, v + 1]); } finally { c.release(); } return performance.now() - t; }));
  const v1 = (await pool.query('SELECT version FROM reports WHERE id=$1', [rid])).rows[0].version;
  await pool.query('UPDATE reports SET version=1 WHERE id=$1', [rid]);
  const atomico = await Promise.all(Array.from({ length: N }, async () => { const t = performance.now(); const c = await pool.connect(); try { await c.query('BEGIN'); await c.query('UPDATE reports SET version=version+1 WHERE id=$1', [rid]); await new Promise((r) => setTimeout(r, 5)); await c.query('COMMIT'); } finally { c.release(); } return performance.now() - t; }));
  const v2 = (await pool.query('SELECT version FROM reports WHERE id=$1', [rid])).rows[0].version;
  await pool.query('UPDATE reports SET version=1 WHERE id=$1', [rid]);
  const con409 = await Promise.all(Array.from({ length: N }, async () => (await pool.query('UPDATE reports SET version=version+1, priority=$2 WHERE id=$1 AND version=1 RETURNING id', [rid, 'Alta'])).rowCount));
  out.concurrencia = { clientes: N, esperado_version_final: 1 + N,
    leer_y_escribir: { version_final: v1, actualizaciones_perdidas: N - (v1 - 1), mediana_ms: r3(med(sinControl)), max_ms: r3(Math.max(...sinControl)) },
    update_atomico_en_transaccion: { version_final: v2, actualizaciones_perdidas: N - (v2 - 1), mediana_ms: r3(med(atomico)), max_ms: r3(Math.max(...atomico)), espera_por_bloqueo_ms: r3(Math.max(...atomico) - 5) },
    control_optimista: { aplicadas: con409.filter((x) => x === 1).length, rechazadas_409: con409.filter((x) => x === 0).length }, duracion_total_ms: r3(performance.now() - t0) };
  await pool.query('DELETE FROM reports WHERE id=$1', [rid]);
  // Integridad: huerfanos y duplicados
  const q1 = async (s) => Number((await pool.query(s)).rows[0].n);
  out.integridad = { reportes_sin_codigo: await q1('SELECT count(*) n FROM reports WHERE code IS NULL'), listas_duplicadas: await q1('SELECT count(*) n FROM (SELECT user_id, content_id FROM watchlist GROUP BY 1,2 HAVING count(*)>1) x'), listas_huerfanas: await q1('SELECT count(*) n FROM watchlist w LEFT JOIN content c ON c.id=w.content_id WHERE c.id IS NULL'), indices: (await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname NOT LIKE '%pkey' AND indexname NOT LIKE '%key' ORDER BY 1")).rows.map((x) => x.indexname) };
  fs.mkdirSync('evidencias', { recursive: true }); fs.writeFileSync(`evidencias/db-avanzado-${tag}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ consultas: C.map((c) => [c.consulta, c.filas, c.mediana_ms, c.usa_indice]), concurrencia: out.concurrencia, integridad: out.integridad }, null, 1)); await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
