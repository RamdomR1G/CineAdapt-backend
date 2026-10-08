const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function initDb() {
  await pool.query(`

    -- Usuarios del sistema
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(100)  NOT NULL,
      email         VARCHAR(150)  UNIQUE NOT NULL,
      password_hash VARCHAR(255)  NOT NULL,
      role          VARCHAR(20)   NOT NULL DEFAULT 'user',
      created_at    TIMESTAMP     DEFAULT NOW()
    );

    -- Contenido principal: peliculas y series
    CREATE TABLE IF NOT EXISTS content (
      id                  SERIAL PRIMARY KEY,
      title               VARCHAR(200) NOT NULL,
      description         TEXT         NOT NULL,
      type                VARCHAR(20)  NOT NULL CHECK (type IN ('movie','series')),
      status              VARCHAR(20)  NOT NULL DEFAULT 'published'
                                       CHECK (status IN ('published','upcoming','draft')),
      genre               VARCHAR(100),
      poster_url          TEXT,
      trailer_url         TEXT,
      -- Video subido desde el dispositivo (Cloudinary)
      video_url           TEXT,
      video_public_id     TEXT,
      -- Video externo (YouTube, Vimeo, etc.)
      external_video_url  TEXT,
      release_year        INTEGER,
      created_at          TIMESTAMP DEFAULT NOW()
    );

    -- Temporadas (solo para series)
    CREATE TABLE IF NOT EXISTS seasons (
      id             SERIAL PRIMARY KEY,
      content_id     INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      season_number  INTEGER NOT NULL,
      title          VARCHAR(200),
      UNIQUE(content_id, season_number)
    );

    -- Episodios de cada temporada
    CREATE TABLE IF NOT EXISTS episodes (
      id                  SERIAL PRIMARY KEY,
      season_id           INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      episode_number      INTEGER NOT NULL,
      title               VARCHAR(200) NOT NULL,
      description         TEXT,
      -- Video subido desde el dispositivo
      video_url           TEXT,
      video_public_id     TEXT,
      -- Video externo
      external_video_url  TEXT,
      duration_min        INTEGER,
      created_at          TIMESTAMP DEFAULT NOW(),
      UNIQUE(season_id, episode_number)
    );

    -- Lista personal de cada usuario
    CREATE TABLE IF NOT EXISTS watchlist (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_id  INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      added_at    TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, content_id)
    );

    -- Notificaciones para movil y Wear OS
    CREATE TABLE IF NOT EXISTS notifications (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_id  INTEGER REFERENCES content(id) ON DELETE SET NULL,
      type        VARCHAR(50) NOT NULL,
      message     TEXT        NOT NULL,
      read        BOOLEAN     DEFAULT FALSE,
      created_at  TIMESTAMP   DEFAULT NOW()
    );

  `);

  console.log('Base de datos inicializada correctamente.');
}

module.exports = { pool, initDb };
