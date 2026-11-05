const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Doble de prueba: se reemplaza la base de datos real por una funcion falsa
jest.mock('../../src/db/database', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../src/db/database');
const { register, login } = require('../../src/controllers/auth.controller');

function fakeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
beforeEach(() => pool.query.mockReset());

describe('login (unitaria, BD simulada)', () => {
  test('caso valido: credenciales correctas devuelven token con el rol', async () => {
    const hash = bcrypt.hashSync('clave123', 4);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, name: 'Ana', email: 'ana@test.com', role: 'user', password_hash: hash }] });
    const res = fakeRes();
    await login({ body: { email: 'ana@test.com', password: 'clave123' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(jwt.verify(body.token, process.env.JWT_SECRET)).toMatchObject({ id: 5, role: 'user' });
    expect(body.user).not.toHaveProperty('password_hash');
  });

  test('caso invalido: contrasena incorrecta responde 401 sin token', async () => {
    const hash = bcrypt.hashSync('clave123', 4);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, email: 'ana@test.com', role: 'user', password_hash: hash }] });
    const res = fakeRes();
    await login({ body: { email: 'ana@test.com', password: 'otra' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Credenciales incorrectas.' });
  });

  test('caso invalido: correo inexistente da el mismo mensaje (no revela si existe)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = fakeRes();
    await login({ body: { email: 'nadie@test.com', password: 'clave123' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Credenciales incorrectas.' });
  });

  test('caso invalido: campos vacios responde 400 y no consulta la BD', async () => {
    const res = fakeRes();
    await login({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('register (unitaria, BD simulada)', () => {
  const nuevo = (password) => ({ body: { name: 'Luis', email: 'luis@test.com', password } });

  test('caso limite: contrasena de exactamente 8 caracteres se acepta', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
              .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Luis', email: 'luis@test.com', role: 'user' }] });
    const res = fakeRes();
    await register(nuevo('abcdefgh'), res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('caso limite: contrasena de 7 caracteres se rechaza', async () => {
    const res = fakeRes();
    await register(nuevo('abcdefg'), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('la contrasena se guarda cifrada, nunca en texto plano', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] })
              .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Luis', email: 'luis@test.com', role: 'user' }] });
    await register(nuevo('secreta99'), fakeRes());
    const guardado = pool.query.mock.calls[1][1][2];
    expect(guardado).not.toBe('secreta99');
    expect(await bcrypt.compare('secreta99', guardado)).toBe(true);
  });

  test('caso invalido: correo repetido responde 409', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 9 }] });
    const res = fakeRes();
    await register(nuevo('secreta99'), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});
