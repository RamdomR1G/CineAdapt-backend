const multer = require('multer');

// Guarda el archivo en memoria (buffer) para enviarlo directo a Cloudinary.
// Limite de 25 MB para respetar el plan gratuito.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo imagenes y videos.'));
    }
  },
});

module.exports = upload;
