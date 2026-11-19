/**
 * Pruebas UNITARIAS automatizadas (P13/14) - componente critico 3: watchlist (persistencia).
 * La BD se sustituye por un doble: prueba solo la logica del controlador.
 */
jest.mock('../../src/db/database', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../src/db/database');
const { addToWatchlist } = require('../../src/controllers/watchlist.controller');

const res = () => { const r = {}; r.status = jest.fn().mockReturnValue(r); r.json = jest.fn().mockReturnValue(r); return r; };
beforeEach(() => pool.query.mockReset());

describe('addToWatchlist (unitaria)', () => {
  test('AUT-01 entrada valida: inserta y responde 201 con la fila', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ user_id: 1, content_id: 9 }] });
    const r = res(); await addToWatchlist({ user: { id: 1 }, body: { content_id: 9 } }, r);
    expect(r.status).toHaveBeenCalledWith(201);
    expect(pool.query.mock.calls[0][1]).toEqual([1, 9]);
  });
  test.each([[undefined], [null], [0], ['']])('AUT-02 content_id vacio/nulo (%p): 400 y NO consulta la BD', async (v) => {
    const r = res(); await addToWatchlist({ user: { id: 1 }, body: { content_id: v } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
  test('AUT-03 contenido inexistente (FK 23503): 404', async () => {
    pool.query.mockRejectedValueOnce({ code: '23503' });
    const r = res(); await addToWatchlist({ user: { id: 1 }, body: { content_id: 99999 } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
  test('AUT-03b ya estaba en la lista (UNIQUE 23505): 409', async () => {
    pool.query.mockRejectedValueOnce({ code: '23505' });
    const r = res(); await addToWatchlist({ user: { id: 1 }, body: { content_id: 9 } }, r);
    expect(r.status).toHaveBeenCalledWith(409);
  });
  test('excepcion inesperada de la BD se propaga (el manejador global responde 500)', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('conexion perdida'), { code: '08006' }));
    await expect(addToWatchlist({ user: { id: 1 }, body: { content_id: 9 } }, res())).rejects.toThrow('conexion perdida');
  });
});
