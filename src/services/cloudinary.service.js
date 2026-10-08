const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Sube un buffer de archivo a Cloudinary.
 * @param {Buffer} buffer    - Datos del archivo
 * @param {string} folder    - Carpeta destino en Cloudinary ('posters', 'videos', 'trailers')
 * @param {string} resource  - Tipo de recurso: 'image' o 'video'
 * @returns {{ url: string, public_id: string }}
 */
function uploadBuffer(buffer, folder, resource = 'image') {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder:        `cineadapt/${folder}`,
        resource_type: resource,
        // Para videos: calidad automatica para reducir peso
        ...(resource === 'video' && { quality: 'auto' }),
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, public_id: result.public_id });
      }
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}

/**
 * Elimina un archivo de Cloudinary por su public_id.
 * @param {string} publicId
 * @param {string} resource - 'image' o 'video'
 */
async function deleteFile(publicId, resource = 'image') {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resource });
  } catch (e) {
    // No lanzar error si falla el borrado — el archivo puede ya no existir
    console.warn('Cloudinary delete warning:', e.message);
  }
}

module.exports = { uploadBuffer, deleteFile };
