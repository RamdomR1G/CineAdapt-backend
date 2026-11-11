-- Practica 11 - Fase 4: plan de ejecucion (EXPLAIN ANALYZE) de 3+ consultas reales de la API.
-- Uso: psql -U postgres -d cineadapt_wb -f scripts/explain.sql
-- Volumen de prueba (datos ficticios, no sensibles): 2,000 usuarios, 5,000 titulos, 50,000 reportes, 20,000 elementos en listas.
\set ON_ERROR_STOP on
\timing off
INSERT INTO users (name,email,password_hash) SELECT 'Usuario '||g,'carga'||g||'@wb.test','x' FROM generate_series(1,2000) g ON CONFLICT DO NOTHING;
INSERT INTO content (title,description,type,genre,release_year,status) SELECT 'Carga '||g, repeat('d',200), 'movie', (ARRAY['Accion','Drama','Comedia'])[1+g%3], 2000+g%25, 'published' FROM generate_series(1,4500) g;
INSERT INTO reports (title,description,priority,status,created_by) SELECT 'Reporte '||g,'detalle', (ARRAY['Baja','Media','Alta'])[1+g%3], (ARRAY['Abierto','En proceso','Resuelto'])[1+g%3], (SELECT id FROM users ORDER BY id OFFSET (g%2000) LIMIT 1) FROM generate_series(1,50000) g;
INSERT INTO watchlist (user_id,content_id) SELECT u.id, c.id FROM (SELECT id FROM users ORDER BY id LIMIT 2000) u, LATERAL (SELECT id FROM content ORDER BY id OFFSET (u.id*7)%4000 LIMIT 10) c ON CONFLICT DO NOTHING;
ANALYZE;
SELECT 'filas' AS dato, (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM content) AS content, (SELECT count(*) FROM reports) AS reports, (SELECT count(*) FROM watchlist) AS watchlist;
SELECT indexname, tablename FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname;

\echo '=== Q1 listContent: catalogo publicado (GET /api/content) ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM content WHERE 1=1 AND status = 'published' ORDER BY created_at DESC;
\echo '=== Q2 listReports de un usuario (GET /api/reports) ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT r.*, u.name AS created_by_name, a.name AS assigned_to_name FROM reports r JOIN users u ON u.id = r.created_by LEFT JOIN users a ON a.id = r.assigned_to WHERE r.created_by = 1000 ORDER BY r.created_at DESC;
\echo '=== Q3 login: busqueda por correo (POST /api/auth/login) ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users WHERE email = 'carga1500@wb.test';
\echo '=== Q4 getWatchlist de un usuario (GET /api/watchlist) ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT c.* FROM watchlist w JOIN content c ON c.id = w.content_id WHERE w.user_id = 1000;
\echo '=== Q5 reportes asignados a un agente filtrados por estado ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM reports WHERE assigned_to = 5 AND status = 'Abierto';

\echo '##### PROPUESTA DE CORRECCION: indices #####'
CREATE INDEX IF NOT EXISTS idx_reports_created_by ON reports (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_assigned_to ON reports (assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_content_status_created ON content (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist (user_id);
ANALYZE;
\echo '=== Q1 despues de indices ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM content WHERE 1=1 AND status = 'published' ORDER BY created_at DESC;
\echo '=== Q2 despues de indices ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT r.*, u.name AS created_by_name, a.name AS assigned_to_name FROM reports r JOIN users u ON u.id = r.created_by LEFT JOIN users a ON a.id = r.assigned_to WHERE r.created_by = 1000 ORDER BY r.created_at DESC;
\echo '=== Q4 despues de indices ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT c.* FROM watchlist w JOIN content c ON c.id = w.content_id WHERE w.user_id = 1000;
\echo '=== Q5 despues de indices ==='
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM reports WHERE assigned_to = 5 AND status = 'Abierto';
DROP INDEX idx_reports_created_by, idx_reports_assigned_to, idx_content_status_created, idx_watchlist_user;
