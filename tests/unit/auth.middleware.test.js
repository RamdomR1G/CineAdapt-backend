const jwt = require('jsonwebtoken');
const { authMiddleware, adminMiddleware } = require('../../src/middleware/auth');

// Doble de prueba de la respuesta de Express
function fakeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}
const sign = (payload, opts = { expiresIn: '1h' }) =>
  jwt.sign(payload, process.env.JWT_SECRET, opts);

describe('authMiddleware (unitaria)', () => {
  test('caso valido: token correcto llama next y guarda el usuario', () => {
    const req = { headers: { authorization: 'Bearer ' + sign({ id: 7, role: 'user' }) } };
    const res = fakeRes(); const next = jest.fn();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: 7, role: 'user' });
  });

  test('caso limite: token ya vencido responde 401', () => {
    const req = { headers: { authorization: 'Bearer ' + sign({ id: 1 }, { expiresIn: -1 }) } };
    const res = fakeRes(); const next = jest.fn();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('caso invalido: sin encabezado Authorization responde 401 Token requerido', () => {
    const res = fakeRes(); const next = jest.fn();
    authMiddleware({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Token requerido.' });
    expect(next).not.toHaveBeenCalled();
  });

  test('caso invalido: token firmado con otro secreto responde 401', () => {
    const falso = jwt.sign({ id: 1, role: 'admin' }, 'otro-secreto');
    const res = fakeRes(); const next = jest.fn();
    authMiddleware({ headers: { authorization: 'Bearer ' + falso } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('adminMiddleware (unitaria)', () => {
  test('rol user recibe 403', () => {
    const req = { headers: { authorization: 'Bearer ' + sign({ id: 2, role: 'user' }) } };
    const res = fakeRes(); const next = jest.fn();
    adminMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('rol admin pasa', () => {
    const req = { headers: { authorization: 'Bearer ' + sign({ id: 1, role: 'admin' }) } };
    const res = fakeRes(); const next = jest.fn();
    adminMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
