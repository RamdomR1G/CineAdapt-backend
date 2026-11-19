-- Practica 12: deja la base de pruebas (cineadapt_wb) en un estado conocido y repetible.
-- 5,000 titulos publicados, 2,001 usuarios, 50,126 reportes de carga, 20,000 elementos de lista.
UPDATE content SET status = 'published' WHERE title LIKE 'Carga %';
DELETE FROM reports WHERE title LIKE 'Estres %' OR title = 'Concurrencia';
VACUUM ANALYZE;
SELECT (SELECT count(*) FROM content WHERE status='published') AS publicados, (SELECT count(*) FROM reports) AS reportes, (SELECT count(*) FROM users) AS usuarios, (SELECT count(*) FROM watchlist) AS lista;
