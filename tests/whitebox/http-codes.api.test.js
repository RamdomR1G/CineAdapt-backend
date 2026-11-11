/**
 * Practica 11 - Fase 3: White box de endpoints (codigos HTTP, estructura JSON, datos sensibles).
 * Cada caso registra: esperado (segun la practica) y obtenido (real). Los desvios son defectos, no fallos de la prueba.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../src/app');
const { pool, prepararBD, limpiarBD, cerrarBD } = require('../helpers/db');

const registro = [];
function anotar(id, endpoint, descripcion, esperado, res, nota = '') {
  registro.push({ id, endpoint, descripcion, esperado, obtenido: res.status, conforme: esperado === res.status,
    json: /json/.test(res.headers['content-type'] || ''), llaves: res.body && typeof res.body === 'object' ? Object.keys(res.body) : [], nota });
}
const U = { name: 'Usuario Uno', email: 'u1@wb.test', password: 'clave1234' };
const AD = { name: 'Admin', email: 'ad@wb.test', password: 'clave1234' };
let user, admin, content;

async function entrar(u, role) {
  await request(app).post('/api/auth/register').send(u);
  if (role) await pool.query('UPDATE users SET role=$1 WHERE email=$2', [role, u.email]);
  const r = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password });
  return { H: { Authorization: 'Bearer ' + r.body.token }, id: r.body.user.id, token: r.body.token };
}

beforeAll(async () => { await prepararBD(); });
afterAll(async () => {
  fs.mkdirSync(path.join(__dirname, '../../evidencias'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../../evidencias/http-codes.json'), JSON.stringify(registro, null, 2));
  await cerrarBD();
});
beforeEach(async () => {
  await limpiarBD();
  user = await entrar(U); admin = await entrar(AD, 'admin');
  const c = await pool.query("INSERT INTO content (title, description, type, genre, release_year, status) VALUES ('Pelicula WB','d','movie','Accion',2020,'published') RETURNING id");
  content = c.rows[0].id;
});

describe('Respuestas exitosas', () => {
  test('HTTP-01 GET /api/content -> 200 y arreglo JSON', async () => {
    const r = await request(app).get('/api/content?status=published').set(user.H);
    anotar('HTTP-01', 'GET /api/content', 'consulta exitosa', 200, r);
    expect(r.status).toBe(200); expect(Array.isArray(r.body)).toBe(true);
  });
  test('HTTP-02 POST /api/auth/register -> 201 sin contrasena en la respuesta', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'Nuevo', email: 'n@wb.test', password: 'clave1234' });
    anotar('HTTP-02', 'POST /api/auth/register', 'registro creado', 201, r);
    expect(r.status).toBe(201); expect(JSON.stringify(r.body)).not.toMatch(/password|hash/i);
  });
  test('HTTP-03 POST /api/reports -> 201', async () => {
    const r = await request(app).post('/api/reports').set(user.H).send({ title: 'Falla', description: 'No carga', priority: 'Alta' });
    anotar('HTTP-03', 'POST /api/reports', 'registro creado', 201, r);
    expect(r.status).toBe(201); expect(r.body.code).toBe('REP001');
  });
  test('HTTP-04 DELETE /api/reports/:id -> la practica espera 204; la API responde 200 con mensaje (desvio documentado)', async () => {
    const c = await request(app).post('/api/reports').set(user.H).send({ title: 'Falla', description: 'No carga' });
    const r = await request(app).delete('/api/reports/' + c.body.id).set(user.H);
    anotar('HTTP-04', 'DELETE /api/reports/:id', 'eliminacion sin cuerpo', 204, r, 'La API devuelve 200 con {message}.');
    expect(r.status).toBe(200);
  });
});

describe('Errores de validacion y de recurso', () => {
  test('HTTP-05 registro sin campos -> 400', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'x' });
    anotar('HTTP-05', 'POST /api/auth/register', 'datos mal estructurados', 400, r); expect(r.status).toBe(400);
  });
  test('HTTP-06 reporte con prioridad invalida -> 400 (la practica sugiere 422 para validacion semantica)', async () => {
    const r = await request(app).post('/api/reports').set(user.H).send({ title: 'x', description: 'y', priority: 'Urgente' });
    anotar('HTTP-06', 'POST /api/reports', 'validacion semantica fallida', 422, r, 'La API usa 400 para toda validacion; 422 no se utiliza.');
    expect(r.status).toBe(400);
  });
  test('HTTP-07 JSON mal formado -> 400', async () => {
    const r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    anotar('HTTP-07', 'POST /api/auth/login', 'cuerpo JSON invalido', 400, r); expect(r.status).toBe(400);
  });
  test('HTTP-08 recursos inexistentes -> 404', async () => {
    const a = await request(app).get('/api/reports/999999').set(admin.H);
    const b = await request(app).get('/api/content/999999').set(user.H);
    anotar('HTTP-08a', 'GET /api/reports/:id', 'recurso inexistente', 404, a); anotar('HTTP-08b', 'GET /api/content/:id', 'recurso inexistente', 404, b);
    expect(a.status).toBe(404); expect(b.status).toBe(404);
  });
  test('HTTP-09 conflictos -> 409 (correo duplicado y version vieja)', async () => {
    const a = await request(app).post('/api/auth/register').send(U);
    const c = await request(app).post('/api/reports').set(user.H).send({ title: 'x', description: 'y' });
    await request(app).put('/api/reports/' + c.body.id).set(user.H).send({ title: 'nuevo', version: c.body.version });
    const b = await request(app).put('/api/reports/' + c.body.id).set(user.H).send({ title: 'otro', version: c.body.version });
    anotar('HTTP-09a', 'POST /api/auth/register', 'correo duplicado', 409, a); anotar('HTTP-09b', 'PUT /api/reports/:id', 'version desactualizada', 409, b);
    expect(a.status).toBe(409); expect(b.status).toBe(409);
  });
});

describe('Autenticacion (401) frente a autorizacion (403)', () => {
  test('HTTP-10 sin token, token alterado y credenciales falsas -> 401', async () => {
    const a = await request(app).get('/api/reports');
    const b = await request(app).get('/api/reports').set('Authorization', 'Bearer ' + user.token.slice(0, -3) + 'abc');
    const c = await request(app).post('/api/auth/login').send({ email: U.email, password: 'incorrecta1' });
    anotar('HTTP-10a', 'GET /api/reports', 'sin token', 401, a); anotar('HTTP-10b', 'GET /api/reports', 'token alterado', 401, b); anotar('HTTP-10c', 'POST /api/auth/login', 'contrasena incorrecta', 401, c);
    expect([a.status, b.status, c.status]).toEqual([401, 401, 401]);
  });
  test('HTTP-11 usuario autenticado sin permiso -> 403 (no 401)', async () => {
    const a = await request(app).get('/api/agents').set(user.H);
    const b = await request(app).put('/api/admin/users/role').set(user.H).send({ email: AD.email, role: 'agent' });
    const c = await request(app).get('/api/agents');
    anotar('HTTP-11a', 'GET /api/agents', 'usuario sin permisos', 403, a); anotar('HTTP-11b', 'PUT /api/admin/users/role', 'usuario sin permisos', 403, b); anotar('HTTP-11c', 'GET /api/agents', 'sin autenticar (debe ser 401, no 403)', 401, c);
    expect([a.status, b.status, c.status]).toEqual([403, 403, 401]);
  });
  test('HTTP-12 el usuario no puede ver el reporte de otro -> 403', async () => {
    const otro = await entrar({ name: 'Otro', email: 'o@wb.test', password: 'clave1234' });
    const c = await request(app).post('/api/reports').set(user.H).send({ title: 'x', description: 'y' });
    const r = await request(app).get('/api/reports/' + c.body.id).set(otro.H);
    anotar('HTTP-12', 'GET /api/reports/:id', 'reporte ajeno', 403, r); expect(r.status).toBe(403);
  });
});

describe('Errores inesperados (500) - hallazgos', () => {
  test('HTTP-13 identificadores no numericos provocan 500 en lugar de 400/404 (DEF-BE-02)', async () => {
    const a = await request(app).get('/api/content/abc').set(user.H);
    const b = await request(app).delete('/api/watchlist/abc').set(user.H);
    anotar('HTTP-13a', 'GET /api/content/abc', 'id invalido', 400, a, 'Consulta con id no numerico: error de PostgreSQL 22P02 sin capturar.');
    anotar('HTTP-13b', 'DELETE /api/watchlist/abc', 'id invalido', 400, b, 'Igual que arriba.');
    expect([a.status, b.status]).toEqual([500, 500]);
    expect(a.body.message).toBeDefined();
  });
  test('HTTP-14 un origen CORS no permitido responde 500 en lugar de 403 (DEF-BE-03)', async () => {
    const r = await request(app).get('/health').set('Origin', 'https://sitio-malicioso.example');
    anotar('HTTP-14', 'GET /health (Origin ajeno)', 'origen no permitido', 403, r, 'El middleware lanza Error sin status.');
    expect(r.status).toBe(500);
  });
  test('HTTP-15 sin JWT_SECRET configurado el login valido responde 500 (DEF-BE-04)', async () => {
    const guardado = process.env.JWT_SECRET; delete process.env.JWT_SECRET;
    const r = await request(app).post('/api/auth/login').send({ email: U.email, password: U.password });
    process.env.JWT_SECRET = guardado;
    anotar('HTTP-15', 'POST /api/auth/login', 'configuracion incompleta', 200, r, 'El servidor arranca sin validar la variable.');
    expect(r.status).toBe(500);
  });
  test('HTTP-16 el 500 devuelve al cliente el mensaje interno de PostgreSQL (fuga de informacion, DEF-BE-05)', async () => {
    const r = await request(app).get('/api/content/abc').set(user.H);
    anotar('HTTP-16', 'GET /api/content/abc', 'el error no debe revelar detalles internos', 500, r, 'Cuerpo: ' + JSON.stringify(r.body));
    expect(r.body.message).toMatch(/invalid input syntax for type integer/);          // detalle interno expuesto
    expect(JSON.stringify(r.body)).not.toMatch(/at\s.+\.js|node_modules|pg-pool/);    // pero no se expone la traza de pila
  });
});

describe('Datos sensibles y estructura JSON', () => {
  test('HTTP-17 ninguna respuesta exitosa contiene contrasenas, hashes ni tokens ajenos', async () => {
    const cuerpos = [];
    cuerpos.push((await request(app).get('/api/auth/me').set(user.H)).body);
    cuerpos.push((await request(app).get('/api/content').set(user.H)).body);
    cuerpos.push((await request(app).get('/api/users/lookup?email=' + AD.email).set(user.H)).body);
    const rep = await request(app).post('/api/reports').set(user.H).send({ title: 'x', description: 'y' }); cuerpos.push(rep.body);
    cuerpos.push((await request(app).get('/api/reports').set(admin.H)).body);
    cuerpos.push((await request(app).get('/api/messages').set(user.H)).body);
    const txt = JSON.stringify(cuerpos);
    expect(txt).not.toMatch(/password|hash|\$2[aby]\$|eyJ[A-Za-z0-9_-]{10,}/i);
  });
  test('HTTP-18 todos los errores comparten la estructura { message: string }', async () => {
    const errores = [
      await request(app).post('/api/auth/register').send({}), await request(app).get('/api/reports'), await request(app).get('/api/agents').set(user.H),
      await request(app).get('/api/reports/999999').set(admin.H), await request(app).post('/api/auth/register').send(U),
    ];
    for (const e of errores) { expect(Object.keys(e.body)).toEqual(['message']); expect(typeof e.body.message).toBe('string'); }
  });
  test('HTTP-19 la API nunca responde 200 ante una operacion fallida', async () => {
    const fallidas = [
      await request(app).post('/api/auth/login').send({ email: U.email, password: 'mala-clave' }),
      await request(app).post('/api/watchlist').set(user.H).send({ content_id: 999999 }),
      await request(app).delete('/api/watchlist/999999').set(user.H),
      await request(app).post('/api/messages').set(user.H).send({ to_user_id: 999999, body: 'hola' }),
    ];
    for (const f of fallidas) expect(f.status).toBeGreaterThanOrEqual(400);
  });
});
