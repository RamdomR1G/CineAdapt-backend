/** Unitaria (P13/14): carrera en el registro - la restriccion UNIQUE debe dar 409, no 500 (DEF-BE-06). */
jest.mock('../../src/db/database', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../src/db/database');
const { register } = require('../../src/controllers/auth.controller');
const res = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
const body = { name: 'Ana', email: 'ana@auto.test', password: 'clave1234' };
beforeEach(() => pool.query.mockReset());

test('AUT-03 UNIQUE (23505) al insertar -> 409', async () => {
  pool.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce({ code: '23505' });
  const r = res(); await register({ body }, r);
  expect(r.status).toHaveBeenCalledWith(409);
});
test('excepcion inesperada al insertar se propaga', async () => {
  pool.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('caida'));
  await expect(register({ body }, res())).rejects.toThrow('caida');
});
