const request = require('supertest');
const app = require('../../src/app');
const { pool, prepararBD, limpiarBD, cerrarBD } = require('../helpers/db');

const U1 = { name: 'Usuario Uno', email: 'u1@prueba.test', password: 'clave1234' };
const U2 = { name: 'Usuario Dos', email: 'u2@prueba.test', password: 'clave1234' };
const AG = { name: 'Agente Uno',  email: 'ag@prueba.test', password: 'clave1234' };
const AD = { name: 'Admin',       email: 'ad@prueba.test', password: 'clave1234' };

async function entrar(u, role) {
  await request(app).post('/api/auth/register').send(u).expect(201);
  if (role) await pool.query('UPDATE users SET role=$1 WHERE email=$2', [role, u.email]);
  const r = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200);
  return { H: { Authorization: 'Bearer ' + r.body.token }, id: r.body.user.id };
}
const nuevoReporte = (s, extra = {}) =>
  request(app).post('/api/reports').set(s.H).send({ title: 'No carga el video', description: 'Se queda en negro', priority: 'Media', ...extra });

let u1, u2, ag, ad;
beforeAll(prepararBD);
afterAll(cerrarBD);
beforeEach(async () => {
  await limpiarBD();
  u1 = await entrar(U1); u2 = await entrar(U2); ag = await entrar(AG, 'agent'); ad = await entrar(AD, 'admin');
});

describe('Reportes: operaciones y validaciones', () => {
  test('TC01 alta valida: se guarda, recibe codigo REP001 y el dueno sale del token', async () => {
    const r = await nuevoReporte(u1, { created_by: u2.id });   // intento de suplantar al dueno
    expect(r.status).toBe(201);
    expect(r.body.code).toBe('REP001');
    expect(r.body.created_by).toBe(u1.id);
    expect(r.body.status).toBe('Abierto');
  });

  test('TC02 campos vacios o invalidos se rechazan con 400', async () => {
    for (const body of [{ title: '', description: '' }, { title: 'x' }, { title: 'x', description: 'y', priority: 'Urgente' },
                        { title: 'x'.repeat(151), description: 'y' }, { title: { a: 1 }, description: 'y' }]) {
      const r = await request(app).post('/api/reports').set(u1.H).send(body);
      expect(r.status).toBe(400);
    }
    expect((await pool.query('SELECT 1 FROM reports')).rowCount).toBe(0);
  });

  test('TC03 el mismo reporte enviado dos veces crea dos registros con codigos distintos', async () => {
    const a = await nuevoReporte(u1); const b = await nuevoReporte(u1);
    expect([a.body.code, b.body.code]).toEqual(['REP001', 'REP002']);
  });

  test('TC04 cambiar la prioridad se conserva al consultar de nuevo', async () => {
    const { body } = await nuevoReporte(u1);
    await request(app).put('/api/reports/' + body.id).set(u1.H).send({ priority: 'Alta' }).expect(200);
    const g = await request(app).get('/api/reports/' + body.id).set(u1.H).expect(200);
    expect(g.body.priority).toBe('Alta');
  });

  test('TC05 eliminar: el reporte ya no aparece y consultarlo da 404', async () => {
    const { body } = await nuevoReporte(u1);
    await request(app).delete('/api/reports/' + body.id).set(u1.H).expect(200);
    await request(app).get('/api/reports/' + body.id).set(u1.H).expect(404);
    expect((await request(app).get('/api/reports').set(u1.H)).body).toHaveLength(0);
  });

  test('TC06 reporte inexistente o id invalido no rompe el servidor', async () => {
    await request(app).get('/api/reports/999').set(u1.H).expect(404);
    await request(app).get('/api/reports/abc').set(u1.H).expect(400);
  });
});

describe('Reportes: roles y permisos (matriz de seguridad)', () => {
  test('SEG-01/02/10 acceso sin sesion o con token alterado se rechaza', async () => {
    await request(app).get('/api/reports').expect(401);
    await request(app).get('/api/reports').set('Authorization', 'Bearer x.y.z').expect(401);
  });

  test('SEG-05 un usuario no puede leer el reporte de otro (403) y no lo ve en su lista', async () => {
    const { body } = await nuevoReporte(u1);
    await request(app).get('/api/reports/' + body.id).set(u2.H).expect(403);
    expect((await request(app).get('/api/reports').set(u2.H)).body).toHaveLength(0);
  });

  test('SEG-06/07 un usuario no puede modificar ni eliminar el reporte de otro', async () => {
    const { body } = await nuevoReporte(u1);
    await request(app).put('/api/reports/' + body.id).set(u2.H).send({ title: 'Hack' }).expect(403);
    await request(app).delete('/api/reports/' + body.id).set(u2.H).expect(403);
    const g = await pool.query('SELECT title FROM reports WHERE id=$1', [body.id]);
    expect(g.rows[0].title).toBe('No carga el video');
  });

  test('SEG-08 el dueno puede actualizar lo suyo, pero no el estado', async () => {
    const { body } = await nuevoReporte(u1);
    await request(app).put('/api/reports/' + body.id).set(u1.H).send({ title: 'Nuevo titulo' }).expect(200);
    await request(app).put('/api/reports/' + body.id).set(u1.H).send({ status: 'Resuelto' }).expect(403);
  });

  test('SEG-09 nadie puede cambiar el propietario ni la asignacion con PUT', async () => {
    const { body } = await nuevoReporte(u1);
    await request(app).put('/api/reports/' + body.id).set(u1.H).send({ created_by: u2.id }).expect(403);
    await request(app).put('/api/reports/' + body.id).set(ad.H).send({ created_by: u2.id }).expect(403);
    await request(app).put('/api/reports/' + body.id).set(u1.H).send({ assigned_to: u1.id }).expect(403);
    expect((await pool.query('SELECT created_by FROM reports WHERE id=$1', [body.id])).rows[0].created_by).toBe(u1.id);
  });

  test('solo el administrador asigna; el destino debe ser agente', async () => {
    const { body } = await nuevoReporte(u1);
    await request(app).put(`/api/reports/${body.id}/assign`).set(u1.H).send({ agent_id: ag.id }).expect(403);
    await request(app).put(`/api/reports/${body.id}/assign`).set(ag.H).send({ agent_id: ag.id }).expect(403);
    await request(app).put(`/api/reports/${body.id}/assign`).set(ad.H).send({ agent_id: u2.id }).expect(400);
    const ok = await request(app).put(`/api/reports/${body.id}/assign`).set(ad.H).send({ agent_id: ag.id }).expect(200);
    expect(ok.body.assigned_to).toBe(ag.id);
    expect(ok.body.status).toBe('En proceso');
  });

  test('el agente solo ve lo asignado y puede cambiar estado; el admin ve todo', async () => {
    const a = (await nuevoReporte(u1)).body; const b = (await nuevoReporte(u2)).body;
    await request(app).put(`/api/reports/${a.id}/assign`).set(ad.H).send({ agent_id: ag.id }).expect(200);
    expect((await request(app).get('/api/reports').set(ag.H)).body.map(r => r.id)).toEqual([a.id]);
    await request(app).get('/api/reports/' + b.id).set(ag.H).expect(403);
    await request(app).put('/api/reports/' + a.id).set(ag.H).send({ status: 'Resuelto' }).expect(200);
    expect((await request(app).get('/api/reports').set(ad.H)).body).toHaveLength(2);
  });

  test('el administrador convierte una cuenta en agente; un usuario no puede', async () => {
    await request(app).put('/api/admin/users/role').set(u1.H).send({ email: U2.email, role: 'agent' }).expect(403);
    const r = await request(app).put('/api/admin/users/role').set(ad.H).send({ email: U2.email, role: 'agent' }).expect(200);
    expect(r.body.role).toBe('agent');
    await request(app).put('/api/admin/users/role').set(ad.H).send({ email: AD.email, role: 'user' }).expect(403);
    await request(app).put('/api/admin/users/role').set(ad.H).send({ email: U1.email, role: 'admin' }).expect(400);
  });
});

describe('Reportes: conflictos y persistencia (practica 9)', () => {
  test('dos cambios en campos distintos se conservan ambos', async () => {
    const { body } = await nuevoReporte(u1);
    await request(app).put(`/api/reports/${body.id}/assign`).set(ad.H).send({ agent_id: ag.id }).expect(200);
    await request(app).put('/api/reports/' + body.id).set(ag.H).send({ status: 'Resuelto' }).expect(200);   // dispositivo A
    await request(app).put('/api/reports/' + body.id).set(ad.H).send({ priority: 'Alta' }).expect(200);     // dispositivo B
    const f = (await pool.query('SELECT status, priority FROM reports WHERE id=$1', [body.id])).rows[0];
    expect(f).toEqual({ status: 'Resuelto', priority: 'Alta' });
  });

  test('con el campo version, la segunda escritura con datos viejos recibe 409 y no pisa', async () => {
    const { body } = await nuevoReporte(u1);
    const v = body.version;
    await request(app).put('/api/reports/' + body.id).set(ad.H).send({ priority: 'Alta', version: v }).expect(200);
    const r = await request(app).put('/api/reports/' + body.id).set(u1.H).send({ priority: 'Baja', version: v });
    expect(r.status).toBe(409);
    expect((await pool.query('SELECT priority FROM reports WHERE id=$1', [body.id])).rows[0].priority).toBe('Alta');
  });
});

describe('Mensajes y recomendaciones', () => {
  test('buscar por correo exacto devuelve solo id y nombre; sin coincidencia da 404', async () => {
    const r = await request(app).get('/api/users/lookup').query({ email: U2.email }).set(u1.H).expect(200);
    expect(Object.keys(r.body).sort()).toEqual(['id', 'name']);
    await request(app).get('/api/users/lookup').query({ email: 'nadie@x.test' }).set(u1.H).expect(404);
    await request(app).get('/api/users/lookup').query({ email: U1.email }).set(u1.H).expect(400);
  });

  test('enviar mensaje valido aparece en recibidos del otro y en enviados del emisor con contadores', async () => {
    const c = await pool.query("INSERT INTO content (title,description,type) VALUES ('Peli','d','movie') RETURNING id");
    await request(app).post('/api/messages').set(u1.H).send({ to_user_id: u2.id, content_id: c.rows[0].id, body: 'Te va a gustar' }).expect(201);
    const rec = (await request(app).get('/api/messages').set(u2.H)).body;
    expect(rec.received[0]).toMatchObject({ body: 'Te va a gustar', from_name: 'Usuario Uno', content_title: 'Peli' });
    expect(rec.counts).toEqual({ sent: 0, received: 1 });
    expect((await request(app).get('/api/messages').set(u1.H)).body.counts).toEqual({ sent: 1, received: 0 });
  });

  test('mensajes vacios, demasiado largos, a si mismo o a destinatario inexistente se rechazan', async () => {
    const s = (b) => request(app).post('/api/messages').set(u1.H).send(b);
    expect((await s({ to_user_id: u2.id, body: '   ' })).status).toBe(400);
    expect((await s({ to_user_id: u2.id, body: 'x'.repeat(281) })).status).toBe(400);
    expect((await s({ to_user_id: u1.id, body: 'hola' })).status).toBe(400);
    expect((await s({ to_user_id: 9999, body: 'hola' })).status).toBe(404);
    expect((await s({ to_user_id: u2.id, content_id: 9999, body: 'hola' })).status).toBe(404);
    expect((await pool.query('SELECT 1 FROM messages')).rowCount).toBe(0);
  });

  test('limpiar historial borra solo lo mio; el otro conserva su copia', async () => {
    await request(app).post('/api/messages').set(u1.H).send({ to_user_id: u2.id, body: 'hola' }).expect(201);
    await request(app).delete('/api/messages').set(u2.H).expect(200);
    expect((await request(app).get('/api/messages').set(u2.H)).body.received).toHaveLength(0);
    expect((await request(app).get('/api/messages').set(u1.H)).body.sent).toHaveLength(1);
  });

  test('sin sesion no se puede enviar ni leer', async () => {
    await request(app).get('/api/messages').expect(401);
    await request(app).post('/api/messages').send({ to_user_id: 1, body: 'x' }).expect(401);
  });
});
