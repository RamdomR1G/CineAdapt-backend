-- Ejecutar despues de levantar el servidor por primera vez
-- El servidor crea las tablas automaticamente al iniciar
--
-- psql -U postgres -d cineadapt_db -f seed.sql

-- Admin: admin@cineadapt.com / admin123
INSERT INTO users (name, email, password_hash, role) VALUES (
  'Administrador',
  'admin@cineadapt.com',
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGS.dCEsTHjAVL9m3.7QxX9ZQ6K',
  'admin'
) ON CONFLICT (email) DO NOTHING;

-- Usuario demo: demo@cineadapt.com / user123
INSERT INTO users (name, email, password_hash, role) VALUES (
  'Usuario Demo',
  'demo@cineadapt.com',
  '$2a$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'user'
) ON CONFLICT (email) DO NOTHING;

-- Pelicula de ejemplo
INSERT INTO content (title, description, type, status, genre, release_year, external_video_url) VALUES (
  'Inception',
  'Un ladron especializado en robar secretos del subconsciente durante el estado de sueno.',
  'movie', 'published', 'Ciencia ficcion', 2010,
  'https://www.youtube.com/watch?v=YoHD9XEInc0'
) ON CONFLICT DO NOTHING;

-- Serie de ejemplo
INSERT INTO content (title, description, type, status, genre, release_year) VALUES (
  'Breaking Bad',
  'Un profesor de quimica con cancer terminal se convierte en fabricante de metanfetaminas.',
  'series', 'published', 'Drama', 2008
) ON CONFLICT DO NOTHING;

-- Proxima entrega (no visible para usuarios aun)
INSERT INTO content (title, description, type, status, genre, release_year) VALUES (
  'Dune: Parte Tres',
  'La conclusion epica de la saga de Paul Atreides.',
  'movie', 'upcoming', 'Ciencia ficcion', 2026
) ON CONFLICT DO NOTHING;
