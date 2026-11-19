/**
 * Pruebas de INTEGRACION automatizadas (P13/14) con API + PostgreSQL reales.
 * AUT-04 codigos HTTP de la API | AUT-06 persistencia de registros
 */
const request = require('supertest');
const app = require('../../src/app');
const { pool, prepararBD, limpiarBD, cerrarBD } = require('../helpers/db');

const ANA = { name: 'Ana Prueba', email: 'ana@auto.test', password: 'clave1234' };
beforeAll(prepararBD); beforeEach(limpiarBD); afterAll(cerrarBD);

describe('AUT-04 API: codigos HTTP del flujo de autenticacion', () => {
  test('registro valido -> 201 y no devuelve el hash', async () => {
    const r = await request(app).post('/api/auth/register').send(ANA);
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash/i);
  });
  test('registro con campos faltantes -> 400', async () => {
    expect((await request(app).post('/api/auth/register').send({ name: 'x' })).status).toBe(400);
  });
  test('registro con contrasena de 7 caracteres -> 400 (regla que el cliente ya replica)', async () => {
    expect((await request(app).post('/api/auth/register').send({ ...ANA, password: '1234567' })).status).toBe(400);
  });
  test('correo duplicado -> 409', async () => {
    await request(app).post('/api/auth/register').send(ANA).expect(201);
    expect((await request(app).post('/api/auth/register').send(ANA)).status).toBe(409);
  });
  test('login correcto -> 200 con token; incorrecto -> 401', async () => {
    await request(app).post('/api/auth/register').send(ANA).expect(201);
    const ok = await request(app).post('/api/auth/login').send({ email: ANA.email, password: ANA.password });
    expect(ok.status).toBe(200); expect(ok.body.token).toEqual(expect.any(String));
    expect((await request(app).post('/api/auth/login').send({ email: ANA.email, password: 'otra-clave' })).status).toBe(401);
  });
  test('ruta protegida sin token -> 401', async () => {
    expect((await request(app).get('/api/watchlist')).status).toBe(401);
  });
});

describe('AUT-06 Persistencia: los datos quedan guardados en PostgreSQL', () => {
  test('el usuario registrado existe en la tabla users y la contrasena esta cifrada', async () => {
    await request(app).post('/api/auth/register').send(ANA).expect(201);
    const { rows } = await pool.query('SELECT name, email, role, password_hash FROM users WHERE email=$1', [ANA.email]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: ANA.name, role: 'user' });
    expect(rows[0].password_hash).not.toBe(ANA.password);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
  });
  test('la lista de pendientes persiste entre sesiones (nuevo login) y no se duplica', async () => {
    await request(app).post('/api/auth/register').send(ANA).expect(201);
    const { rows: c } = await pool.query("INSERT INTO content (title,description,type,status,genre) VALUES ('Peli Auto','s','movie','published','Accion') RETURNING id");
    const t1 = (await request(app).post('/api/auth/login').send(ANA)).body.token;
    await request(app).post('/api/watchlist').set('Authorization', `Bearer ${t1}`).send({ content_id: c[0].id }).expect(201);
    await request(app).post('/api/watchlist').set('Authorization', `Bearer ${t1}`).send({ content_id: c[0].id }).expect(409);
    const t2 = (await request(app).post('/api/auth/login').send(ANA)).body.token;   // "cerrar y abrir la app"
    const lista = await request(app).get('/api/watchlist').set('Authorization', `Bearer ${t2}`).expect(200);
    expect(lista.body.map(x => x.title)).toEqual(['Peli Auto']);
    const { rows: n } = await pool.query('SELECT count(*)::int AS n FROM watchlist');
    expect(n[0].n).toBe(1);
  });
  test('un registro rechazado (400) no deja filas en la BD', async () => {
    await request(app).post('/api/auth/register').send({ ...ANA, password: '123' }).expect(400);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0].n).toBe(0);
  });
});
