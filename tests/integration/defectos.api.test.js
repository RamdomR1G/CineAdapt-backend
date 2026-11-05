const request = require('supertest');
const app = require('../../src/app');
const { prepararBD, limpiarBD, cerrarBD, pool } = require('../helpers/db');

beforeAll(prepararBD);
beforeEach(limpiarBD);
afterAll(cerrarBD);

const registrar = (extra) => request(app).post('/api/auth/register')
  .send({ name: 'Ana', email: 'ana@prueba.test', password: 'clave1234', ...extra });

describe('Defectos encontrados (cada prueba describe el comportamiento CORRECTO)', () => {
  test('DEF-01: un correo sin formato valido debe rechazarse con 400', async () => {
    const r = await registrar({ email: 'no-es-correo' });
    expect(r.status).toBe(400);
  });

  test('DEF-02: agregar a la lista un contenido inexistente debe dar 404, no 500', async () => {
    await registrar();
    const l = await request(app).post('/api/auth/login').send({ email: 'ana@prueba.test', password: 'clave1234' });
    const r = await request(app).post('/api/watchlist').set('Authorization', 'Bearer ' + l.body.token).send({ content_id: 99999 });
    expect(r.status).toBe(404);
    expect(r.body.message).not.toMatch(/constraint|violates/i);
  });

  test('DEF-03: contrasena que no es texto debe dar 400, no 500', async () => {
    const r = await registrar({ password: { a: 1 } });
    expect(r.status).toBe(400);
  });

  test('DEF-04: nombre de mas de 100 caracteres debe dar 400 sin filtrar mensajes de la BD', async () => {
    const r = await registrar({ name: 'n'.repeat(150) });
    expect(r.status).toBe(400);
    expect(r.body.message).not.toMatch(/varying|value too long/i);
  });
});
