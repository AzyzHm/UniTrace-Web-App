/**
 * FICHIER : tests/unit/common/validate-object-id.test.js
 *
 * RÔLE
 *   Teste le middleware validateObjectId : accepte un identifiant MongoDB (24 caractères
 *   hexadécimaux) et refuse tout le reste avec 400 VALIDATION_ERROR, sans appeler la suite.
 *
 * TESTE
 *   middlewares/common/validate-object-id.js
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/unit/common/validate-object-id.test.js
 */
import { describe, expect, it, vi } from 'vitest';
import { validateObjectId } from '../../../src/middlewares/common/validate-object-id.js';

const run = (middleware, params) => {
  const req = { params };
  const next = vi.fn();
  middleware(req, {}, next);
  return { req, next };
};

describe('validateObjectId', () => {
  it.each(['650000000000000000000001', 'AABBCCDDEEFF001122334455'])('accepts %s', (id) => {
    const { next } = run(validateObjectId(), { id });

    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ['text', 'abc'],
    ['a route word', 'saved'],
    ['23 characters', '65000000000000000000000'],
    ['25 characters', '6500000000000000000000011'],
    ['non hexadecimal characters', '65000000000000000000000z'],
    ['an empty id', ''],
    ['a Mongo operator', '{"$ne":null}'],
  ])('refuses %s with VALIDATION_ERROR', (label, id) => {
    const { next } = run(validateObjectId(), { id });

    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details[0]).toEqual({ field: 'id', message: 'id must be a valid id' });
  });

  it('refuses a missing id', () => {
    const { next } = run(validateObjectId(), {});

    expect(next.mock.calls[0][0].code).toBe('VALIDATION_ERROR');
  });

  it('can check another parameter name', () => {
    const { next } = run(validateObjectId('savedId'), { savedId: 'nope' });

    expect(next.mock.calls[0][0].details[0].field).toBe('savedId');
  });
});
