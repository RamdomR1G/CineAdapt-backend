const { pool }          = require('../db/database');
const { uploadBuffer }  = require('../services/cloudinary');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Determina si un archivo subido es video o imagen segun su mimetype
function resourceType(mimetype) {
  return mimetype.startsWith('video/') ? 'video' : 'image';
}

// Notifica a todos los usuarios sobre contenido nuevo
async function notifyAll(contentId, type, message) {
  const { rows: users } = await pool.query('SELECT id FROM users WHERE role = $1', ['user']);
  if (!users.length) return;
  const values = users.map((_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`).join(',');
  const params = users.flatMap(u => [u.id, contentId, type, message]);
  await pool.query(
    `INSERT INTO notifications (user_id, content_id, type, message) VALUES ${values}`,
    params
  );
}

// ── Contenido ─────────────────────────────────────────────────────────────────

async function listContent(req, res) {
  const { type, status, genre, search } = req.query;
  let query  = 'SELECT * FROM content WHERE 1=1';
  const params = [];
  let i = 1;

  // Usuarios normales solo ven contenido publicado
  if (req.user.role !== 'admin') {
    query += ` AND status = 'published'`;
  } else if (status && status !== 'all') {
    query += ` AND status = $${i++}`;
    params.push(status);
  }

  if (type)   { query += ` AND type = $${i++}`;  params.push(type); }
  if (genre)  { query += ` AND genre = $${i++}`; params.push(genre); }
  if (search) {
    query += ` AND (title ILIKE $${i} OR description ILIKE $${i})`;
    params.push(`%${search}%`);
    i++;
  }

  query += ' ORDER BY created_at DESC';
  const { rows } = await pool.query(query, params);
  res.json(rows);
}

async function getContent(req, res) {
  const { rows } = await pool.query('SELECT * FROM content WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Contenido no encontrado.' });

  const content = rows[0];

  // Si es serie, incluir temporadas y episodios
  if (content.type === 'series') {
    const { rows: seasons } = await pool.query(
      'SELECT * FROM seasons WHERE content_id = $1 ORDER BY season_number',
      [content.id]
    );
    for (const season of seasons) {
      const { rows: episodes } = await pool.query(
        'SELECT * FROM episodes WHERE season_id = $1 ORDER BY episode_number',
        [season.id]
      );
      season.episodes = episodes;
    }
    content.seasons = seasons;
  }

  res.json(content);
}

async function createContent(req, res) {
  const {
    title, description, type, status, genre,
    release_year, external_video_url, trailer_url,
  } = req.body;

  if (!title || !description || !type)
    return res.status(400).json({ message: 'Titulo, descripcion y tipo son obligatorios.' });

  // Subir archivos a Cloudinary si vienen en la peticion
  let poster_url = null;
  let video_url  = null;

  if (req.files?.poster) {
    const file   = req.files.poster[0];
    const result = await uploadBuffer(file.buffer, 'cineadapt/posters', 'image');
    poster_url   = result.secure_url;
  }
  if (req.files?.video) {
    const file   = req.files.video[0];
    const result = await uploadBuffer(file.buffer, 'cineadapt/videos', 'video');
    video_url    = result.secure_url;
  }

  const { rows } = await pool.query(
    `INSERT INTO content
      (title, description, type, status, genre, poster_url, trailer_url, video_url, external_video_url, release_year)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [title, description, type, status || 'draft', genre || null,
     poster_url, trailer_url || null, video_url, external_video_url || null,
     release_year || null]
  );

  const content = rows[0];

  // Si se publica directamente, notificar a los usuarios
  if (content.status === 'published') {
    const msg = content.type === 'movie'
      ? `Nueva pelicula disponible: ${content.title}`
      : `Nueva serie disponible: ${content.title}`;
    await notifyAll(content.id, 'new_content', msg);
  }

  res.status(201).json(content);
}

async function updateContent(req, res) {
  const { id } = req.params;
  const existing = await pool.query('SELECT * FROM content WHERE id = $1', [id]);
  if (!existing.rows.length) return res.status(404).json({ message: 'No encontrado.' });

  const prev = existing.rows[0];
  const {
    title, description, type, status, genre,
    release_year, external_video_url, trailer_url,
  } = req.body;

  let poster_url = prev.poster_url;
  let video_url  = prev.video_url;

  if (req.files?.poster) {
    const result = await uploadBuffer(req.files.poster[0].buffer, 'cineadapt/posters', 'image');
    poster_url   = result.secure_url;
  }
  if (req.files?.video) {
    const result = await uploadBuffer(req.files.video[0].buffer, 'cineadapt/videos', 'video');
    video_url    = result.secure_url;
  }

  const { rows } = await pool.query(
    `UPDATE content SET
      title=$1, description=$2, type=$3, status=$4, genre=$5,
      poster_url=$6, trailer_url=$7, video_url=$8, external_video_url=$9, release_year=$10
     WHERE id=$11 RETURNING *`,
    [title || prev.title, description || prev.description, type || prev.type,
     status || prev.status, genre ?? prev.genre,
     poster_url, trailer_url ?? prev.trailer_url,
     video_url, external_video_url ?? prev.external_video_url,
     release_year ?? prev.release_year, id]
  );

  // Si acaba de publicarse (antes era draft/upcoming), notificar
  if (prev.status !== 'published' && rows[0].status === 'published') {
    const msg = `${rows[0].type === 'movie' ? 'Pelicula' : 'Serie'} ahora disponible: ${rows[0].title}`;
    await notifyAll(rows[0].id, 'new_content', msg);
  }

  res.json(rows[0]);
}

async function deleteContent(req, res) {
  const { rows } = await pool.query('DELETE FROM content WHERE id=$1 RETURNING id', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'No encontrado.' });
  res.json({ message: 'Eliminado.' });
}

// ── Temporadas ────────────────────────────────────────────────────────────────

async function createSeason(req, res) {
  const { content_id, season_number, title } = req.body;
  if (!content_id || !season_number)
    return res.status(400).json({ message: 'content_id y season_number son obligatorios.' });

  const { rows } = await pool.query(
    'INSERT INTO seasons (content_id, season_number, title) VALUES ($1,$2,$3) RETURNING *',
    [content_id, season_number, title || null]
  );
  res.status(201).json(rows[0]);
}

async function updateSeason(req, res) {
  const { title } = req.body;
  const { rows } = await pool.query(
    'UPDATE seasons SET title=$1 WHERE id=$2 RETURNING *',
    [title, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Temporada no encontrada.' });
  res.json(rows[0]);
}

async function deleteSeason(req, res) {
  const { rows } = await pool.query('DELETE FROM seasons WHERE id=$1 RETURNING id', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'No encontrada.' });
  res.json({ message: 'Temporada eliminada.' });
}

// ── Episodios ─────────────────────────────────────────────────────────────────

async function createEpisode(req, res) {
  const { season_id, episode_number, title, description, external_video_url, duration_min } = req.body;
  if (!season_id || !episode_number || !title)
    return res.status(400).json({ message: 'season_id, episode_number y title son obligatorios.' });

  let video_url = null;
  if (req.files?.video) {
    const result = await uploadBuffer(req.files.video[0].buffer, 'cineadapt/episodes', 'video');
    video_url    = result.secure_url;
  }

  const { rows } = await pool.query(
    `INSERT INTO episodes
      (season_id, episode_number, title, description, video_url, external_video_url, duration_min)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [season_id, episode_number, title, description || null,
     video_url, external_video_url || null, duration_min || null]
  );

  // Notificar nuevo episodio
  const season = await pool.query(
    'SELECT s.*, c.title as content_title FROM seasons s JOIN content c ON c.id=s.content_id WHERE s.id=$1',
    [season_id]
  );
  if (season.rows.length) {
    const s   = season.rows[0];
    const msg = `Nuevo episodio de ${s.content_title} — T${s.season_number}E${episode_number}: ${title}`;
    await notifyAll(s.content_id, 'new_episode', msg);
  }

  res.status(201).json(rows[0]);
}

async function updateEpisode(req, res) {
  const { id } = req.params;
  const prev = await pool.query('SELECT * FROM episodes WHERE id=$1', [id]);
  if (!prev.rows.length) return res.status(404).json({ message: 'Episodio no encontrado.' });

  const p = prev.rows[0];
  const { title, description, external_video_url, duration_min } = req.body;

  let video_url = p.video_url;
  if (req.files?.video) {
    const result = await uploadBuffer(req.files.video[0].buffer, 'cineadapt/episodes', 'video');
    video_url    = result.secure_url;
  }

  const { rows } = await pool.query(
    `UPDATE episodes SET
      title=$1, description=$2, video_url=$3, external_video_url=$4, duration_min=$5
     WHERE id=$6 RETURNING *`,
    [title || p.title, description ?? p.description, video_url,
     external_video_url ?? p.external_video_url, duration_min ?? p.duration_min, id]
  );
  res.json(rows[0]);
}

async function deleteEpisode(req, res) {
  const { rows } = await pool.query('DELETE FROM episodes WHERE id=$1 RETURNING id', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'No encontrado.' });
  res.json({ message: 'Episodio eliminado.' });
}

module.exports = {
  listContent, getContent, createContent, updateContent, deleteContent,
  createSeason, updateSeason, deleteSeason,
  createEpisode, updateEpisode, deleteEpisode,
};
