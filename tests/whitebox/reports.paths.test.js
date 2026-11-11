/**
 * Practica 11 - Fase 2/3: caminos de reports.controller.js, messages.controller.js y watchlist.controller.js
 * que las pruebas funcionales no ejecutaban (validaciones, filtros, borrado de asignacion, errores de red de Cloudinary).
 */
jest.mock('../../src/services/cloudinary', () => ({ uploadBuffer: jest.fn(), deleteFile: jest.fn() }));
const request = require('supertest');
const cloud = require('../../src/services/cloudinary');
const app = require('../../src/app');
const { pool, prepararBD, limpiarBD, cerrarBD } = require('../helpers/db');

async function entrar(email, role) {
  await request(app).post('/api/auth/register').send({ name: 'Persona ' + email.split('@')[0], email, password: 'clave1234' });
  if (role) await pool.query('UPDATE users SET role=$1 WHERE email=$2', [role, email]);
  const r = await request(app).post('/api/auth/login').send({ email, password: 'clave1234' });
  return { H: { Authorization: 'Bearer ' + r.body.token }, id: r.body.user.id };
}
let u, ad, ag, rep;
beforeAll(prepararBD); afterAll(cerrarBD);
beforeEach(async () => {
  await limpiarBD(); cloud.uploadBuffer.mockReset();
  u = await entrar('u@p.test'); ad = await entrar('ad@p.test', 'admin'); ag = await entrar('ag@p.test', 'agent');
  rep = (await request(app).post('/api/reports').set(u.H).send({ title: 'Falla', description: 'No carga' })).body;
});

describe('Alta con adjunto (Cloudinary)', () => {
  test('con imagen: guarda la URL devuelta por el servicio', async () => {
    cloud.uploadBuffer.mockResolvedValue({ secure_url: 'https://res.cloudinary.test/captura.png' });
    const r = await request(app).post('/api/reports').set(u.H).field('title', 'Con captura').field('description', 'd').attach('attachment', Buffer.from('png'), 'a.png');
    expect(r.status).toBe(201); expect(r.body.attachment_url).toBe('https://res.cloudinary.test/captura.png');
  });
  test('EXCEPCION: si Cloudinary falla (sin red) la API responde 500 y no crea el reporte', async () => {
    cloud.uploadBuffer.mockRejectedValue(new Error('ENOTFOUND api.cloudinary.com'));
    const r = await request(app).post('/api/reports').set(u.H).field('title', 'Con captura').field('description', 'd').attach('attachment', Buffer.from('png'), 'a.png');
    expect(r.status).toBe(500);
    expect((await pool.query("SELECT 1 FROM reports WHERE title='Con captura'")).rowCount).toBe(0);
  });
});

describe('Listado y filtros por estado', () => {
  test('filtra por estado valido', async () => {
    const r = await request(app).get('/api/reports?status=Abierto').set(u.H); expect(r.status).toBe(200); expect(r.body).toHaveLength(1);
    const v = await request(app).get('/api/reports?status=Resuelto').set(u.H); expect(v.body).toHaveLength(0);
  });
  test('el administrador ve todos y puede filtrar por estado (consulta sin filtro previo de dueno)', async () => {
    expect((await request(app).get('/api/reports?status=Abierto').set(ad.H)).body).toHaveLength(1);
    expect((await request(app).get('/api/reports?status=Resuelto').set(ad.H)).body).toHaveLength(0);
  });
  test('estado invalido -> 400', async () => { expect((await request(app).get('/api/reports?status=Cerrado').set(u.H)).status).toBe(400); });
});

describe('Edicion: validaciones por campo y roles', () => {
  test.each([['abc', 400], ['999999', 404]])('PUT /reports/%s -> %i', async (id, cod) => {
    expect((await request(app).put('/api/reports/' + id).set(ad.H).send({ status: 'Resuelto' })).status).toBe(cod);
  });
  test('sin cambios -> 400', async () => { expect((await request(app).put('/api/reports/' + rep.id).set(u.H).send({ version: 1 })).status).toBe(400); });
  test.each([
    [{ title: '' }, 'Titulo'], [{ description: 'x'.repeat(2001) }, 'Descripcion'], [{ priority: 'Urgente' }, 'Prioridad'], [{ status: 'Cerrado' }, 'Estado'],
  ])('valor invalido %j -> 400', async (cuerpo, texto) => {
    const r = await request(app).put('/api/reports/' + rep.id).set(ad.H).send(cuerpo); expect(r.status).toBe(400); expect(r.body.message).toMatch(texto);
  });
  test('el administrador puede cambiar prioridad y estado; el agente asignado cambia el estado', async () => {
    expect((await request(app).put('/api/reports/' + rep.id).set(ad.H).send({ priority: 'Alta' })).body.priority).toBe('Alta');
    await request(app).put(`/api/reports/${rep.id}/assign`).set(ad.H).send({ agent_id: ag.id });
    const r = await request(app).put('/api/reports/' + rep.id).set(ag.H).send({ status: 'Resuelto' }); expect(r.status).toBe(200); expect(r.body.status).toBe('Resuelto');
  });
});

describe('Asignacion, baja y consulta de agentes', () => {
  test('asignar con identificador de reporte no numerico -> 400', async () => { expect((await request(app).put('/api/reports/abc/assign').set(ad.H).send({ agent_id: ag.id })).status).toBe(400); });
  test('agent_id con formato invalido -> 400', async () => { expect((await request(app).put(`/api/reports/${rep.id}/assign`).set(ad.H).send({ agent_id: 'x' })).status).toBe(400); });
  test('asignar a alguien que no es agente -> 400', async () => { expect((await request(app).put(`/api/reports/${rep.id}/assign`).set(ad.H).send({ agent_id: u.id })).status).toBe(400); });
  test('asignar reporte inexistente -> 404', async () => { expect((await request(app).put('/api/reports/999999/assign').set(ad.H).send({ agent_id: ag.id })).status).toBe(404); });
  test('quitar asignacion (agent_id null) -> 200 y assigned_to null', async () => {
    await request(app).put(`/api/reports/${rep.id}/assign`).set(ad.H).send({ agent_id: ag.id });
    const r = await request(app).put(`/api/reports/${rep.id}/assign`).set(ad.H).send({ agent_id: null }); expect(r.status).toBe(200); expect(r.body.assigned_to).toBeNull();
  });
  test('el agente solo ve los reportes que tiene asignados', async () => {
    expect((await request(app).get('/api/reports').set(ag.H)).body).toHaveLength(0);
    await request(app).put(`/api/reports/${rep.id}/assign`).set(ad.H).send({ agent_id: ag.id });
    expect((await request(app).get('/api/reports').set(ag.H)).body).toHaveLength(1);
  });
  test('GET /agents lista a los agentes sin datos sensibles', async () => {
    const r = await request(app).get('/api/agents').set(ad.H); expect(r.status).toBe(200); expect(r.body).toHaveLength(1); expect(Object.keys(r.body[0]).sort()).toEqual(['email', 'id', 'name']);
  });
  test.each([['abc', 400], ['999999', 404]])('DELETE /reports/%s -> %i', async (id, cod) => { expect((await request(app).delete('/api/reports/' + id).set(ad.H)).status).toBe(cod); });
});

describe('Cambio de rol (administrador)', () => {
  test('rol invalido -> 400; correo inexistente -> 404; cuenta admin -> 403; exito -> 200', async () => {
    expect((await request(app).put('/api/admin/users/role').set(ad.H).send({ email: 'u@p.test', role: 'admin' })).status).toBe(400);
    expect((await request(app).put('/api/admin/users/role').set(ad.H).send({ email: 'nadie@p.test', role: 'agent' })).status).toBe(404);
    expect((await request(app).put('/api/admin/users/role').set(ad.H).send({ email: 'ad@p.test', role: 'user' })).status).toBe(403);
    const ok = await request(app).put('/api/admin/users/role').set(ad.H).send({ email: 'u@p.test', role: 'agent' }); expect(ok.status).toBe(200); expect(ok.body.role).toBe('agent');
  });
});

describe('Mensajes y lista: excepciones', () => {
  test('buscar usuario sin correo -> 400', async () => { expect((await request(app).get('/api/users/lookup').set(u.H)).status).toBe(400); });
  test('EXCEPCION: un error inesperado de la base al agregar a la lista se propaga como 500 (no se confunde con 404/409)', async () => {
    const cid = (await pool.query("INSERT INTO content (title,description,type,genre,status) VALUES ('T','d','movie','G','published') RETURNING id")).rows[0].id;
    const original = pool.query.bind(pool);
    const espia = jest.spyOn(pool, 'query').mockImplementation((sql, ...r) => (typeof sql === 'string' && sql.startsWith('INSERT INTO watchlist')) ? Promise.reject(Object.assign(new Error('caida de red'), { code: '57P01' })) : original(sql, ...r));
    const r = await request(app).post('/api/watchlist').set(u.H).send({ content_id: cid }); espia.mockRestore();
    expect(r.status).toBe(500);
  });

  test('POST /watchlist sin content_id -> 400', async () => { expect((await request(app).post('/api/watchlist').set(u.H).send({})).status).toBe(400); });
  test.each([
    [{ to_user_id: 'x', body: 'hola' }, 400, 'Destinatario'], [{ to_user_id: 1, body: 123 }, 400, 'vacio'],
    [{ to_user_id: 1, body: 'x'.repeat(281) }, 400, '280'],
  ])('mensaje invalido %j -> %i', async (cuerpo, cod, texto) => {
    const r = await request(app).post('/api/messages').set(u.H).send(cuerpo); expect(r.status).toBe(cod); expect(r.body.message).toMatch(texto);
  });
  test('mensaje con content_id no numerico -> 400', async () => {
    const r = await request(app).post('/api/messages').set(u.H).send({ to_user_id: ad.id, content_id: 'x', body: 'mira esto' }); expect(r.status).toBe(400);
  });
  test('/auth/me con un token valido de un usuario eliminado -> 404', async () => {
    await pool.query('DELETE FROM users WHERE id=$1', [u.id]);
    expect((await request(app).get('/api/auth/me').set(u.H)).status).toBe(404);
  });
});
