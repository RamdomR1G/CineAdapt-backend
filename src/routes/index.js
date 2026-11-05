const router  = require('express').Router();
const upload  = require('../middleware/upload');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const auth    = require('../controllers/auth.controller');
const content = require('../controllers/content.controller');
const wl      = require('../controllers/watchlist.controller');
const notif   = require('../controllers/notifications.controller');
const reports = require('../controllers/reports.controller');
const msgs    = require('../controllers/messages.controller');

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/register', auth.register);
router.post('/auth/login',    auth.login);
router.get ('/auth/me',       authMiddleware, auth.me);

// ── Contenido (lectura) ───────────────────────────────────────────────────────
router.get('/content',     authMiddleware, content.listContent);
router.get('/content/:id', authMiddleware, content.getContent);

// ── Contenido (escritura — solo admin) ───────────────────────────────────────
const contentFiles = upload.fields([
  { name: 'poster', maxCount: 1 },
  { name: 'video',  maxCount: 1 },
]);
const episodeFiles = upload.fields([{ name: 'video', maxCount: 1 }]);

router.post  ('/admin/content',        adminMiddleware, contentFiles, content.createContent);
router.put   ('/admin/content/:id',    adminMiddleware, contentFiles, content.updateContent);
router.delete('/admin/content/:id',    adminMiddleware, content.deleteContent);

router.post  ('/admin/seasons',        adminMiddleware, content.createSeason);
router.put   ('/admin/seasons/:id',    adminMiddleware, content.updateSeason);
router.delete('/admin/seasons/:id',    adminMiddleware, content.deleteSeason);

router.post  ('/admin/episodes',       adminMiddleware, episodeFiles, content.createEpisode);
router.put   ('/admin/episodes/:id',   adminMiddleware, episodeFiles, content.updateEpisode);
router.delete('/admin/episodes/:id',   adminMiddleware, content.deleteEpisode);

// ── Watchlist ─────────────────────────────────────────────────────────────────
router.get   ('/watchlist',             authMiddleware, wl.getWatchlist);
router.post  ('/watchlist',             authMiddleware, wl.addToWatchlist);
router.delete('/watchlist/:content_id', authMiddleware, wl.removeFromWatchlist);

// ── Notificaciones ────────────────────────────────────────────────────────────
router.get('/notifications',          authMiddleware, notif.getNotifications);
router.get('/notifications/unread',   authMiddleware, notif.unreadCount);
router.put('/notifications/:id/read', authMiddleware, notif.markRead);
router.put('/notifications/read-all', authMiddleware, notif.markAllRead);

// ── Soporte: reportes, agentes y roles ────────────────────────────────────────
router.post  ('/reports',            authMiddleware, upload.single('attachment'), reports.createReport);
router.get   ('/reports',            authMiddleware, reports.listReports);
router.get   ('/reports/:id',        authMiddleware, reports.getReport);
router.put   ('/reports/:id',        authMiddleware, reports.updateReport);
router.put   ('/reports/:id/assign', adminMiddleware, reports.assignReport);
router.delete('/reports/:id',        authMiddleware, reports.deleteReport);
router.get   ('/agents',             adminMiddleware, reports.listAgents);
router.put   ('/admin/users/role',   adminMiddleware, reports.setUserRole);

// ── Mensajes y recomendaciones ────────────────────────────────────────────────
router.get   ('/users/lookup', authMiddleware, msgs.lookupUser);
router.post  ('/messages',     authMiddleware, msgs.sendMessage);
router.get   ('/messages',     authMiddleware, msgs.listMessages);
router.delete('/messages',     authMiddleware, msgs.clearMessages);

module.exports = router;
