// Tablas del modulo de soporte (practicas 7, 9 y 10) y de mensajes (practica 6)
module.exports = `
  CREATE TABLE IF NOT EXISTS reports (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(20) UNIQUE,
    title          VARCHAR(150) NOT NULL,
    description    TEXT NOT NULL,
    priority       VARCHAR(10) NOT NULL DEFAULT 'Media'
                   CHECK (priority IN ('Baja','Media','Alta','Crítica')),
    status         VARCHAR(20) NOT NULL DEFAULT 'Abierto'
                   CHECK (status IN ('Abierto','En proceso','Resuelto')),
    created_by     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    attachment_url TEXT,
    version        INTEGER NOT NULL DEFAULT 1,
    created_at     TIMESTAMP DEFAULT NOW(),
    updated_at     TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS messages (
    id               SERIAL PRIMARY KEY,
    from_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_id       INTEGER REFERENCES content(id) ON DELETE SET NULL,
    body             VARCHAR(280) NOT NULL,
    hidden_sender    BOOLEAN NOT NULL DEFAULT false,
    hidden_receiver  BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMP DEFAULT NOW()
  );
`;
