const { pool }      = require('../db');
const { uploadBuffer, deleteFile } = require('../services/cloudinary.service');

// ── Temporadas ────────────────────────────────────────────────────────────────

// POST /api/admin/content/:contentId/seasons
async function createSeason(req, res) {
  const { contentId } = req.params;
  const { season_number, title } = req.body;

  if (!season_number) {
    return res.status(400).json({ message: 'El numero de temporada es obligatorio.' });
  }

  // Verificar que el contenido sea una serie
  const content = await pool.query(
    `SELECT id FROM content WHERE id = $1 AND type = 'series'`, [contentId]
  );
  if (content.rows.length === 0) {
    return res.status(404).json({ message: 'Serie no encontrada.' });
  }

  const result = await pool.query(
    `INSERT INTO seasons (content_id, season_number, title)
     VALUES ($1, $2, $3) RETURNING *`,
    [contentId, Number(season_number), title || `Temporada ${season_number}`]
  );

  res.status(201).json(result.rows[0]);
}

// PUT /api/admin/seasons/:seasonId
async function updateSeason(req, res) {
  const { seasonId } = req.params;
  const { title, season_number } = req.body;

  const result = await pool.query(
    `UPDATE seasons SET
       title = COALESCE($1, title),
       season_number = COALESCE($2, season_number)
     WHERE id = $3 RETURNING *`,
    [title, season_number ? Number(season_number) : null, seasonId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'Temporada no encontrada.' });
  }
  res.json(result.rows[0]);
}

// DELETE /api/admin/seasons/:seasonId
async function deleteSeason(req, res) {
  const { seasonId } = req.params;

  // Borrar videos de episodios en Cloudinary antes de eliminar
  const episodes = await pool.query(
    'SELECT video_public_id FROM episodes WHERE season_id = $1', [seasonId]
  );
  for (const ep of episodes.rows) {
    if (ep.video_public_id) await deleteFile(ep.video_public_id, 'video');
  }

  await pool.query('DELETE FROM seasons WHERE id = $1', [seasonId]);
  res.json({ message: 'Temporada y sus episodios eliminados.' });
}

// ── Episodios ─────────────────────────────────────────────────────────────────

// GET /api/content/:contentId/seasons/:seasonId/episodes — lista publica
async function getEpisodes(req, res) {
  const { seasonId } = req.params;
  const result = await pool.query(
    `SELECT e.id, e.episode_number, e.title, e.description,
            e.video_url, e.external_video_url, e.duration_min
     FROM episodes e
     JOIN seasons s ON s.id = e.season_id
     JOIN content c ON c.id = s.content_id
     WHERE e.season_id = $1 AND c.status = 'published'
     ORDER BY e.episode_number`,
    [seasonId]
  );
  res.json(result.rows);
}

// POST /api/admin/seasons/:seasonId/episodes
async function createEpisode(req, res) {
  const { seasonId } = req.params;
  const {
    episode_number, title, description,
    external_video_url, duration_min,
  } = req.body;

  if (!episode_number || !title) {
    return res.status(400).json({ message: 'Numero y titulo del episodio son obligatorios.' });
  }

  let video_url       = null;
  let video_public_id = null;

  // Subir video del episodio si se adjunto
  if (req.file) {
    const up = await uploadBuffer(req.file.buffer, 'episodes', 'video');
    video_url       = up.url;
    video_public_id = up.public_id;
  }

  const result = await pool.query(
    `INSERT INTO episodes
       (season_id, episode_number, title, description,
        video_url, video_public_id, external_video_url, duration_min)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      seasonId,
      Number(episode_number),
      title.trim(),
      description || null,
      video_url,
      video_public_id,
      external_video_url || null,
      duration_min ? Number(duration_min) : null,
    ]
  );

  res.status(201).json(result.rows[0]);
}

// PUT /api/admin/episodes/:episodeId
async function updateEpisode(req, res) {
  const { episodeId } = req.params;
  const {
    episode_number, title, description,
    external_video_url, duration_min,
  } = req.body;

  const existing = await pool.query('SELECT * FROM episodes WHERE id = $1', [episodeId]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ message: 'Episodio no encontrado.' });
  }

  const current = existing.rows[0];
  let video_url       = current.video_url;
  let video_public_id = current.video_public_id;

  // Reemplazar video si se subio uno nuevo
  if (req.file) {
    if (current.video_public_id) await deleteFile(current.video_public_id, 'video');
    const up = await uploadBuffer(req.file.buffer, 'episodes', 'video');
    video_url       = up.url;
    video_public_id = up.public_id;
  }

  const result = await pool.query(
    `UPDATE episodes SET
       episode_number     = COALESCE($1, episode_number),
       title              = COALESCE($2, title),
       description        = COALESCE($3, description),
       video_url          = $4,
       video_public_id    = $5,
       external_video_url = COALESCE($6, external_video_url),
       duration_min       = COALESCE($7, duration_min)
     WHERE id = $8
     RETURNING *`,
    [
      episode_number ? Number(episode_number) : null,
      title ?? null,
      description ?? null,
      video_url,
      video_public_id,
      external_video_url ?? null,
      duration_min ? Number(duration_min) : null,
      episodeId,
    ]
  );

  res.json(result.rows[0]);
}

// DELETE /api/admin/episodes/:episodeId
async function deleteEpisode(req, res) {
  const { episodeId } = req.params;
  const existing = await pool.query('SELECT video_public_id FROM episodes WHERE id = $1', [episodeId]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ message: 'Episodio no encontrado.' });
  }

  if (existing.rows[0].video_public_id) {
    await deleteFile(existing.rows[0].video_public_id, 'video');
  }

  await pool.query('DELETE FROM episodes WHERE id = $1', [episodeId]);
  res.json({ message: 'Episodio eliminado.' });
}

module.exports = {
  createSeason, updateSeason, deleteSeason,
  getEpisodes, createEpisode, updateEpisode, deleteEpisode,
};
