const request = require('supertest');
const app = require('../../src/app');
const { pool, prepararBD, limpiarBD, cerrarBD } = require('../helpers/db');

// Datos de prueba ficticios (sin informacion real)
const ANA = { name: 'Ana Prueba', email: 'ana@prueba.test', password: 'clave1234' };
const LUIS = { name: 'Luis Prueba', email: 'luis@prueba.test', password: 'clave5678' };

async function registrarYEntrar(u) {
  await request(app).post('/api/auth/register').send(u).expect(201);
  const r = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200);
  return r.body.token;
}
async function crearContenido(titulo, status = 'published') {
  const { rows } = await pool.query(
    "INSERT INTO content (title, description, type, status, genre) VALUES ($1,'Sinopsis de prueba','movie',$2,'Accion') RETURNING id",
    [titulo, status]);
  return rows[0].id;
}

beforeAll(prepararBD);
beforeEach(limpiarBD);
afterAll(cerrarBD);

describe('Integracion: API + PostgreSQL reales', () => {
  test('registro guarda al usuario con contrasena cifrada y rechaza el correo repetido', async () => {
    await request(app).post('/api/auth/register').send(ANA).expect(201);
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [ANA.email]);
    expect(rows).toHaveLength(1);
    expect(rows[0].password_hash).not.toBe(ANA.password);
    expect(rows[0].role).toBe('user');

    const dup = await request(app).post('/api/auth/register').send(ANA);
    expect(dup.status).toBe(409);
    expect((await pool.query('SELECT 1 FROM users')).rowCount).toBe(1);
  });

  test('login real devuelve token que /auth/me acepta; contrasena mala no', async () => {
    const token = await registrarYEntrar(ANA);
    const me = await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + token).expect(200);
    expect(me.body.email).toBe(ANA.email);
    expect(me.body).not.toHaveProperty('password_hash');

    const mal = await request(app).post('/api/auth/login').send({ email: ANA.email, password: 'incorrecta' });
    expect(mal.status).toBe(401);
    expect(mal.body.token).toBeUndefined();
  });

  test('control de acceso: sin token 401, token alterado 401, usuario normal 403 en rutas admin', async () => {
    const token = await registrarYEntrar(ANA);
    await request(app).get('/api/watchlist').expect(401);
    await request(app).get('/api/watchlist').set('Authorization', 'Bearer ' + token + 'x').expect(401);

    const r = await request(app).post('/api/admin/content').set('Authorization', 'Bearer ' + token).send({ title: 'Hack' });
    expect(r.status).toBe(403);
    expect((await pool.query('SELECT 1 FROM content')).rowCount).toBe(0);
  });

  test('un admin (rol cambiado en la BD) si pasa el control de acceso', async () => {
    await request(app).post('/api/auth/register').send(ANA).expect(201);
    await pool.query("UPDATE users SET role='admin' WHERE email=$1", [ANA.email]);
    const login = await request(app).post('/api/auth/login').send({ email: ANA.email, password: ANA.password });
    const r = await request(app).post('/api/admin/content').set('Authorization', 'Bearer ' + login.body.token).send({});
    expect([401, 403]).not.toContain(r.status);
  });

  test('watchlist: agregar, evitar duplicado (409), listar y quitar con persistencia real', async () => {
    const token = await registrarYEntrar(ANA);
    const id = await crearContenido('Pelicula de prueba');
    const auth = { Authorization: 'Bearer ' + token };

    await request(app).post('/api/watchlist').set(auth).send({ content_id: id }).expect(201);
    const dup = await request(app).post('/api/watchlist').set(auth).send({ content_id: id });
    expect(dup.status).toBe(409);
    expect((await pool.query('SELECT 1 FROM watchlist')).rowCount).toBe(1);

    const lista = await request(app).get('/api/watchlist').set(auth).expect(200);
    expect(lista.body.map(c => c.title)).toEqual(['Pelicula de prueba']);

    await request(app).delete('/api/watchlist/' + id).set(auth).expect(200);
    await request(app).delete('/api/watchlist/' + id).set(auth).expect(404);
    expect((await pool.query('SELECT 1 FROM watchlist')).rowCount).toBe(0);
  });

  test('aislamiento: la lista de un usuario no aparece en la de otro', async () => {
    const tA = await registrarYEntrar(ANA);
    const tB = await registrarYEntrar(LUIS);
    const id = await crearContenido('Solo de Ana');
    await request(app).post('/api/watchlist').set('Authorization', 'Bearer ' + tA).send({ content_id: id }).expect(201);
    const listaB = await request(app).get('/api/watchlist').set('Authorization', 'Bearer ' + tB).expect(200);
    expect(listaB.body).toHaveLength(0);
  });

  test('error: agregar contenido inexistente no tumba el servidor', async () => {
    const token = await registrarYEntrar(ANA);
    const r = await request(app).post('/api/watchlist').set('Authorization', 'Bearer ' + token).send({ content_id: 99999 });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.message).toBeDefined();
  });
});
