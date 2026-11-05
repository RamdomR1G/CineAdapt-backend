// Variables de entorno SOLO para pruebas (base de datos aparte, secreto falso)
process.env.DB_HOST = process.env.TEST_DB_HOST || 'localhost';
process.env.DB_PORT = process.env.TEST_DB_PORT || '5432';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'cineadapt_test';
process.env.DB_USER = process.env.TEST_DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || '';
process.env.DB_SSL = 'false';
process.env.JWT_SECRET = 'secreto-solo-para-pruebas';
process.env.BCRYPT_ROUNDS = '4';
