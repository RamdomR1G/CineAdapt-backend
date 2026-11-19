/**
 * Practica 12 - Fase 6: pruebas de las optimizaciones y de que no introducen defectos nuevos.
 * Cubre: paginacion y campos reducidos, compresion gzip, consulta unica de temporadas y episodios,
 * idempotencia al crear reportes (incluida la condicion de carrera), indices y hash de contrasenas.
 */
const request = require('supertest');
const app = require('../../src/app');
const { pool, prepararBD, limpiarBD, cerrarBD } = require('../helpers/db');
const password = require('../../src/services/password');

let u1, u2, admin;
async function entrar(email, role) {
  await request(app).post('/api/auth/register').send({ name: 'Usuario', email, password: 'clave1234' });
  if (role) await pool.query('UPDATE users SET role=$2 WHERE email=$1', [email, role]);
  const r = await request(app).post('/api/auth/login').send({ email, password: 'clave1234' });
  return { H: { Authorization: 'Bearer ' + r.body.token }, id: r.body.user.id };
}
beforeAll(prepararBD); afterAll(cerrarBD);
beforeEach(async () => { await limpiarBD(); u1 = await entrar('u1@opt.test'); u2 = await entrar('u2@opt.test'); admin = await entrar('adm@opt.test', 'admin'); });
const poblar = (n) => pool.query("INSERT INTO content (title, description, type, genre, status, release_year) SELECT 'Titulo '||g, repeat('d',300), 'movie', 'Drama', 'published', 2000 FROM generate_series(1,$1) g", [n]);

describe('Catalogo paginado (GET /api/content)', () => {
  beforeEach(() => poblar(75));
  test('sin limit devuelve todo el catalogo (compatibilidad) y no envia X-Total-Count', async () => {
    const r = await request(app).get('/api/content?status=published').set(u1.H);
    expect(r.status).toBe(200); expect(r.body).toHaveLength(75); expect(r.headers['x-total-count']).toBeUndefined();
  });
  test('limit/offset devuelven la pagina pedida y el total en X-Total-Count', async () => {
    const r = await request(app).get('/api/content?limit=30&offset=30').set(u1.H);
    expect(r.body).toHaveLength(30); expect(r.headers['x-total-count']).toBe('75');
  });
  test('la ultima pagina es parcial y las paginas no se repiten ni se saltan elementos', async () => {
    const ids = []; for (const off of [0, 30, 60]) ids.push(...(await request(app).get(`/api/content?limit=30&offset=${off}`).set(u1.H)).body.map((x) => x.id));
    expect(ids).toHaveLength(75); expect(new Set(ids).size).toBe(75);
  });
  test('offset mayor al total devuelve lista vacia (no error)', async () => {
    const r = await request(app).get('/api/content?limit=30&offset=500').set(u1.H); expect(r.status).toBe(200); expect(r.body).toEqual([]);
  });
  test.each([['limit=0'], ['limit=101'], ['limit=abc'], ['limit=5&offset=-1'], ['offset=1.5']])('valores invalidos (%s) responden 400', async (q) => {
    const r = await request(app).get('/api/content?' + q).set(u1.H); expect(r.status).toBe(400);
  });
  test('fields=card omite la descripcion y reduce el tamano de la respuesta', async () => {
    const completo = await request(app).get('/api/content?limit=30').set(u1.H);
    const tarjeta = await request(app).get('/api/content?limit=30&fields=card').set(u1.H);
    expect(tarjeta.body[0].description).toBeUndefined(); expect(tarjeta.body[0].title).toBeDefined();
    expect(JSON.stringify(tarjeta.body).length).toBeLessThan(JSON.stringify(completo.body).length * 0.6);
  });
  test('los filtros siguen funcionando junto con la paginacion', async () => {
    const r = await request(app).get('/api/content?search=Titulo 7&limit=5').set(u1.H);
    expect(r.status).toBe(200); expect(r.body.length).toBeLessThanOrEqual(5); expect(r.body.every((x) => /Titulo 7/.test(x.title))).toBe(true);
    expect(Number(r.headers['x-total-count'])).toBe(7);    // Titulo 7 y Titulo 70 a 75
  });
  test('la busqueda tambien encuentra por genero (la pantalla Buscar indica "Titulo o genero")', async () => {
    await pool.query("UPDATE content SET genre='Terror' WHERE id <= 4");
    const r = await request(app).get('/api/content?search=terror&limit=30').set(u1.H);
    expect(r.body.map((x) => x.genre)).toEqual(['Terror', 'Terror', 'Terror', 'Terror']); expect(r.headers['x-total-count']).toBe('4');
  });
  test('un usuario normal no ve contenido no publicado aunque lo pida', async () => {
    await pool.query("UPDATE content SET status='draft' WHERE id <= 10");
    const r = await request(app).get('/api/content?status=draft&limit=100').set(u1.H);
    expect(r.body.every((x) => x.status === 'published')).toBe(true); expect(r.headers['x-total-count']).toBe('65');
  });
});

describe('Compresion gzip', () => {
  test('el catalogo grande se comprime cuando el cliente lo acepta', async () => {
    await poblar(300);
    const r = await request(app).get('/api/content').set(u1.H).set('Accept-Encoding', 'gzip');
    expect(r.headers['content-encoding']).toBe('gzip'); expect(r.body).toHaveLength(300);
  });
  test('una respuesta pequena (menos de 1 KB) no se comprime', async () => {
    const r = await request(app).get('/health').set('Accept-Encoding', 'gzip'); expect(r.headers['content-encoding']).toBeUndefined();
  });
});

describe('Detalle de serie con una sola consulta para temporadas y episodios', () => {
  test('devuelve temporadas ordenadas con sus episodios ordenados y cuenta las consultas ejecutadas', async () => {
    const sid = (await pool.query("INSERT INTO content (title, description, type, status) VALUES ('Serie','d','series','published') RETURNING id")).rows[0].id;
    for (const n of [2, 1, 3]) { const s = (await pool.query('INSERT INTO seasons (content_id, season_number) VALUES ($1,$2) RETURNING id', [sid, n])).rows[0].id;
      await pool.query("INSERT INTO episodes (season_id, episode_number, title) VALUES ($1,2,'b'),($1,1,'a')", [s]); }
    await pool.query("INSERT INTO seasons (content_id, season_number) VALUES ($1, 4)", [sid]);   // temporada sin episodios
    const espia = jest.spyOn(pool, 'query');
    const r = await request(app).get('/api/content/' + sid).set(u1.H); const consultas = espia.mock.calls.filter(([s]) => /FROM (content|seasons|episodes)/.test(String(s))).length; espia.mockRestore();
    expect(r.status).toBe(200); expect(r.body.seasons.map((s) => s.season_number)).toEqual([1, 2, 3, 4]);
    expect(r.body.seasons[0].episodes.map((e) => e.title)).toEqual(['a', 'b']); expect(r.body.seasons[3].episodes).toEqual([]);
    expect(consultas).toBeLessThanOrEqual(2);              // antes: 1 + 1 + una por temporada (6 en este caso)
  });
  test('una pelicula no consulta temporadas', async () => {
    const id = (await pool.query("INSERT INTO content (title, description, type, status) VALUES ('Peli','d','movie','published') RETURNING id")).rows[0].id;
    const espia = jest.spyOn(pool, 'query'); await request(app).get('/api/content/' + id).set(u1.H);
    const n = espia.mock.calls.filter(([s]) => /seasons/.test(String(s))).length; espia.mockRestore(); expect(n).toBe(0);
  });
});

describe('Idempotencia al crear reportes (Idempotency-Key)', () => {
  const crear = (u, key, titulo = 'Reporte') => { const rq = request(app).post('/api/reports').set(u.H); if (key) rq.set('Idempotency-Key', key); return rq.send({ title: titulo, description: 'd' }); };
  test('la misma clave dos veces crea un solo reporte y la repeticion responde 200 con el mismo codigo', async () => {
    const a = await crear(u1, 'clave-uno-0001'); const b = await crear(u1, 'clave-uno-0001');
    expect(a.status).toBe(201); expect(b.status).toBe(200); expect(b.headers['idempotent-replay']).toBe('true'); expect(b.body.id).toBe(a.body.id); expect(b.body.code).toBe(a.body.code);
    expect((await pool.query('SELECT count(*)::int n FROM reports')).rows[0].n).toBe(1);
  });
  test('claves distintas crean reportes distintos', async () => {
    await crear(u1, 'clave-aaaa-0001'); await crear(u1, 'clave-bbbb-0002');
    expect((await pool.query('SELECT count(*)::int n FROM reports')).rows[0].n).toBe(2);
  });
  test('sin cabecera el comportamiento es el anterior (cada envio crea un reporte)', async () => {
    await crear(u1, null); await crear(u1, null); expect((await pool.query('SELECT count(*)::int n FROM reports')).rows[0].n).toBe(2);
  });
  test('la misma clave usada por otro usuario NO devuelve el reporte ajeno', async () => {
    const a = await crear(u1, 'clave-comun-0001'); const b = await crear(u2, 'clave-comun-0001');
    expect(b.status).toBe(201); expect(b.body.id).not.toBe(a.body.id); expect(b.body.created_by).toBe(u2.id);
  });
  test.each([['corta'], ['con espacios aqui 1'], ['x'.repeat(65)], ['raro;drop--']])('clave invalida (%s) responde 400 y no crea nada', async (k) => {
    const r = await crear(u1, k); expect(r.status).toBe(400); expect((await pool.query('SELECT count(*)::int n FROM reports')).rows[0].n).toBe(0);
  });
  test('10 envios simultaneos con la misma clave producen exactamente un reporte', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => crear(u1, 'clave-carrera-001')));
    expect(rs.every((r) => [200, 201].includes(r.status))).toBe(true); expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1); expect((await pool.query('SELECT count(*)::int n FROM reports')).rows[0].n).toBe(1);
  });
  test('el codigo REPxxx siempre queda asignado (una sola sentencia atomica)', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => crear(u1, 'clave-lote-000' + i, 'R' + i)));
    expect((await pool.query('SELECT count(*)::int n FROM reports WHERE code IS NULL')).rows[0].n).toBe(0);
  });
});

describe('Indices y contrasenas', () => {
  test('initDb crea los indices de la Practica 12 y se puede ejecutar mas de una vez', async () => {
    await prepararBD(); await prepararBD();
    const { rows } = await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public'"); const n = rows.map((x) => x.indexname);
    expect(n).toEqual(expect.arrayContaining(['idx_reports_created_by', 'idx_reports_assigned_to', 'idx_content_status_created', 'idx_reports_idem']));
  });
  test('el servicio de contrasenas usa la libreria nativa, genera hashes $2b$ y verifica contrasenas de bcryptjs', async () => {
    expect(password.nativo).toBe(true); const h = await password.hash('clave1234', 4); expect(h).toMatch(/^\$2[ab]\$04\$/);
    expect(await password.compare('clave1234', h)).toBe(true); expect(await password.compare('otra', h)).toBe(false);
    const antiguo = require('bcryptjs').hashSync('clave1234', 4); expect(await password.compare('clave1234', antiguo)).toBe(true);   // usuarios existentes siguen entrando
  });
  test('si bcrypt nativo no esta disponible se usa bcryptjs', () => {
    jest.isolateModules(() => { jest.doMock('bcrypt', () => { throw new Error('sin binario'); }); const p = require('../../src/services/password'); expect(p.nativo).toBe(false); });
    jest.dontMock('bcrypt');
  });
});
