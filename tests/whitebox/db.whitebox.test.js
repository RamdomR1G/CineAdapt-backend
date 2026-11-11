/**
 * Practica 11 - Fase 4: White box de la base de datos (CRUD, integridad, concurrencia, transacciones).
 * Operaciones evaluadas: (1) alta de usuario, (2) alta/edicion de reportes, (3) lista de pendientes (watchlist).
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../src/app');
const { pool, prepararBD, limpiarBD, cerrarBD } = require('../helpers/db');

const evidencia = [];
const anotar = (id, descripcion, resultado) => evidencia.push({ id, descripcion, resultado });
let u1, cid;

async function entrar(email, name = 'Usuario') {
  await request(app).post('/api/auth/register').send({ name, email, password: 'clave1234' });
  const r = await request(app).post('/api/auth/login').send({ email, password: 'clave1234' });
  return { H: { Authorization: 'Bearer ' + r.body.token }, id: r.body.user.id };
}
beforeAll(prepararBD);
afterAll(async () => {
  fs.mkdirSync(path.join(__dirname, '../../evidencias'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../../evidencias/db-whitebox.json'), JSON.stringify(evidencia, null, 2));
  await cerrarBD();
});
beforeEach(async () => {
  await limpiarBD();
  u1 = await entrar('u1@db.test');
  cid = (await pool.query("INSERT INTO content (title, description, type, genre, status) VALUES ('Titulo DB','d','movie','Drama','published') RETURNING id")).rows[0].id;
});

describe('DB-01/DB-02 insercion valida e invalida (restricciones)', () => {
  test('insercion valida guarda la fila y asigna rol por defecto', async () => {
    const { rows } = await pool.query("INSERT INTO users (name,email,password_hash) VALUES ('A','a@db.test','x') RETURNING role");
    expect(rows[0].role).toBe('user'); anotar('DB-01', 'INSERT valido en users', 'OK, role=user por defecto');
  });
  test.each([
    ['NOT NULL', "INSERT INTO users (name,email,password_hash) VALUES (NULL,'b@db.test','x')", '23502'],
    ['UNIQUE', "INSERT INTO users (name,email,password_hash) VALUES ('C','u1@db.test','x')", '23505'],
    ['FOREIGN KEY', "INSERT INTO watchlist (user_id, content_id) VALUES (999999, 1)", '23503'],
    ['CHECK prioridad', "INSERT INTO reports (title,description,priority,created_by) VALUES ('t','d','Urgente',1)", '23514'],
    ['CHECK estado', "INSERT INTO reports (title,description,status,created_by) VALUES ('t','d','Cerrado',1)", '23514'],
    ['longitud VARCHAR(150)', "INSERT INTO reports (title,description,created_by) VALUES (repeat('x',151),'d',1)", '22001'],
  ])('rechaza violacion de %s', async (nombre, sql, codigo) => {
    await expect(pool.query(sql)).rejects.toMatchObject({ code: codigo });
    anotar('DB-02', 'Restriccion ' + nombre, 'Rechazada con SQLSTATE ' + codigo);
  });
});

describe('DB-03 consulta por identificador', () => {
  test('existente devuelve 1 fila; inexistente devuelve 0 filas', async () => {
    expect((await pool.query('SELECT id FROM content WHERE id=$1', [cid])).rowCount).toBe(1);
    expect((await pool.query('SELECT id FROM content WHERE id=$1', [999999])).rowCount).toBe(0);
    anotar('DB-03', 'SELECT por id existente / inexistente', '1 fila / 0 filas');
  });
  test('un identificador no numerico lanza excepcion de PostgreSQL (22P02)', async () => {
    await expect(pool.query('SELECT id FROM content WHERE id=$1', ['abc'])).rejects.toMatchObject({ code: '22P02' });
  });
});

describe('DB-04/DB-05 actualizacion, eliminacion y persistencia', () => {
  test('actualiza, consulta despues y confirma persistencia; incrementa version', async () => {
    const c = await request(app).post('/api/reports').set(u1.H).send({ title: 'Original', description: 'd' });
    const upd = await request(app).put('/api/reports/' + c.body.id).set(u1.H).send({ title: 'Editado', version: c.body.version });
    const { rows } = await pool.query('SELECT title, version FROM reports WHERE id=$1', [c.body.id]);
    expect(upd.status).toBe(200); expect(rows[0]).toEqual({ title: 'Editado', version: 2 });
    anotar('DB-04', 'UPDATE y SELECT posterior', 'titulo=Editado, version 1 -> 2');
  });
  test('eliminar un usuario elimina en cascada sus reportes y su lista (integridad referencial)', async () => {
    await request(app).post('/api/reports').set(u1.H).send({ title: 'x', description: 'y' });
    await request(app).post('/api/watchlist').set(u1.H).send({ content_id: cid });
    await pool.query('DELETE FROM users WHERE id=$1', [u1.id]);
    expect((await pool.query('SELECT 1 FROM reports')).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM watchlist')).rowCount).toBe(0);
    anotar('DB-05', 'DELETE de usuario con ON DELETE CASCADE', 'reportes y lista eliminados; contenido intacto');
    expect((await pool.query('SELECT 1 FROM content')).rowCount).toBe(1);
  });
});

describe('DB-06 concurrencia', () => {
  test('dos ediciones simultaneas con la misma version: una gana (200) y la otra recibe 409', async () => {
    const c = await request(app).post('/api/reports').set(u1.H).send({ title: 'x', description: 'y' });
    const [a, b] = await Promise.all([
      request(app).put('/api/reports/' + c.body.id).set(u1.H).send({ title: 'A', version: c.body.version }),
      request(app).put('/api/reports/' + c.body.id).set(u1.H).send({ title: 'B', version: c.body.version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    anotar('DB-06a', '2 UPDATE simultaneos con control optimista (version)', 'Codigos ' + [a.status, b.status].sort().join(' y '));
  });
  test('dos altas simultaneas a la lista del mismo titulo: una 201 y la otra 409 (UNIQUE)', async () => {
    const r = await Promise.all([1, 2].map(() => request(app).post('/api/watchlist').set(u1.H).send({ content_id: cid })));
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    anotar('DB-06b', '2 INSERT simultaneos en watchlist', 'Codigos 201 y 409');
  });
  test('DEF-BE-06: 10 registros simultaneos con el mismo correo -> el patron SELECT-luego-INSERT deja pasar errores 500', async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => request(app).post('/api/auth/register').send({ name: 'Dup', email: 'dup@db.test', password: 'clave1234' })));
    const codigos = r.map((x) => x.status).sort();
    const filas = (await pool.query("SELECT 1 FROM users WHERE email='dup@db.test'")).rowCount;
    anotar('DB-06c', '10 registros simultaneos del mismo correo', 'Codigos: ' + JSON.stringify(codigos.reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {})) + '; filas guardadas: ' + filas);
    expect(filas).toBe(1);                                  // la restriccion UNIQUE protege la integridad
    expect(codigos.filter((c) => c === 201)).toHaveLength(1);
    expect(codigos.some((c) => c === 500)).toBe(true);      // pero la API responde 500 en vez de 409 (condicion de carrera)
  });
});

describe('DB-07 transacciones y operaciones parciales', () => {
  test('DEF-BE-07: crear un reporte son 2 sentencias sin transaccion; si falla la segunda queda un reporte sin codigo', async () => {
    const original = pool.query.bind(pool);
    const espia = jest.spyOn(pool, 'query').mockImplementation((sql, ...resto) =>
      (typeof sql === 'string' && sql.startsWith('UPDATE reports SET code')) ? Promise.reject(new Error('fallo simulado')) : original(sql, ...resto));
    const r = await request(app).post('/api/reports').set(u1.H).send({ title: 'Parcial', description: 'd' });
    espia.mockRestore();
    const { rows } = await pool.query("SELECT id, code FROM reports WHERE title='Parcial'");
    anotar('DB-07', 'Fallo simulado entre INSERT y UPDATE del codigo', 'HTTP ' + r.status + '; fila huerfana con code=' + rows[0]?.code);
    expect(r.status).toBe(500); expect(rows).toHaveLength(1); expect(rows[0].code).toBeNull();
  });
  test('un reporte sin codigo no rompe la unicidad de code (NULL permitido) y el siguiente alta funciona', async () => {
    await pool.query("INSERT INTO reports (title,description,created_by) VALUES ('s1','d',$1),('s2','d',$1)", [u1.id]);
    const r = await request(app).post('/api/reports').set(u1.H).send({ title: 'Nuevo', description: 'd' });
    expect(r.status).toBe(201);
  });
});

describe('Seguridad: inyeccion SQL', () => {
  test.each(["' OR '1'='1", "'; DROP TABLE users; --", "x' UNION SELECT password_hash FROM users --"])('entrada maliciosa %s se trata como dato', async (txt) => {
    const a = await request(app).get('/api/content').query({ search: txt, genre: txt, type: txt }).set(u1.H);
    const b = await request(app).post('/api/auth/login').send({ email: txt, password: txt });
    const c = await request(app).get('/api/users/lookup').query({ email: txt }).set(u1.H);
    expect(a.status).toBe(200); expect(a.body).toEqual([]);
    expect([b.status, c.status]).toEqual([401, 404]);
    expect((await pool.query('SELECT 1 FROM users')).rowCount).toBe(1);   // la tabla sigue existiendo
  });
  test('los nombres de columna de updateReport salen de una lista blanca, no del cliente', async () => {
    const c = await request(app).post('/api/reports').set(u1.H).send({ title: 'x', description: 'y' });
    const r = await request(app).put('/api/reports/' + c.body.id).set(u1.H).send({ 'title = title, created_by': 1, version: 1 });
    expect(r.status).toBe(403);
  });
});
