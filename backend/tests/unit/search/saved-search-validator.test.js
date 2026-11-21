/**
 * FICHIER : tests/unit/search/saved-search-validator.test.js
 *
 * RÔLE
 *   Teste le schéma Joi du corps de POST /search/saved et le middleware validateSavedSearch :
 *   critères acceptés, au moins un critère, champs refusés, nettoyage des valeurs.
 *
 * TESTE
 *   validators/search/saved-search.validator.js, middlewares/search/validate-saved-search.js
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/unit/search/saved-search-validator.test.js
 */
import { describe, expect, it, vi } from 'vitest';
import { validateSavedSearch } from '../../../src/middlewares/search/validate-saved-search.js';
import { savedSearchSchema } from '../../../src/validators/search/saved-search.validator.js';

const check = (body) => savedSearchSchema.validate(body, { abortEarly: false });

describe('savedSearchSchema', () => {
  it('accepts every criterion together', () => {
    const { error, value } = check({
      name: 'All',
      q: 'sac noir',
      type: 'found',
      category: 'wallet_bag',
      location: 'Library',
      color: 'black',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      hasPhoto: true,
    });

    expect(error).toBeUndefined();
    expect(value.dateFrom).toBeInstanceOf(Date);
    expect(value.hasPhoto).toBe(true);
  });

  it.each([
    { q: 'sac' },
    { type: 'lost' },
    { category: 'keys' },
    { location: 'Gym' },
    { color: 'red' },
  ])('accepts a single criterion %o', (body) => {
    expect(check(body).error).toBeUndefined();
  });

  it('accepts hasPhoto false alone (without photo is a real choice)', () => {
    expect(check({ hasPhoto: false }).error).toBeUndefined();
  });

  it('requires at least one criterion and says which ones', () => {
    const { error } = check({ name: 'Only a name' });

    expect(error.details[0].message).toContain('at least one search criterion is required');
    expect(error.details[0].message).toContain('hasPhoto');
  });

  it('trims the text', () => {
    expect(check({ q: '  sac  ' }).value.q).toBe('sac');
  });

  it.each([
    ['a text of one character', { q: 'a' }],
    ['an empty text', { q: '' }],
    ['a text over 200 characters', { q: 'x'.repeat(201) }],
    ['an unknown type', { type: 'stolen' }],
    ['an unknown category', { category: 'spaceship' }],
    ['a bad date', { dateFrom: 'yesterday' }],
    ['dateTo before dateFrom', { dateFrom: '2026-10-20', dateTo: '2026-10-10' }],
    ['a bad hasPhoto', { type: 'lost', hasPhoto: 'maybe' }],
    ['an empty name', { type: 'lost', name: '' }],
    ['a name over 60 characters', { type: 'lost', name: 'x'.repeat(61) }],
  ])('refuses %s', (label, body) => {
    expect(check(body).error).toBeDefined();
  });

  it.each(['status', 'sort', 'page', 'limit', 'owner', '_id', 'createdAt'])(
    'does not let the client send %s',
    (field) => {
      const { error } = savedSearchSchema.validate(
        { type: 'lost', [field]: 'x' },
        { allowUnknown: false },
      );

      expect(error).toBeDefined();
    },
  );

  it('gives a date only dateTo the end of its day', () => {
    const { value } = check({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });

    expect(value.dateTo.toISOString()).toBe('2026-10-31T23:59:59.999Z');
  });
});

describe('validateSavedSearch', () => {
  const run = (body) => {
    const req = { body };
    const next = vi.fn();
    validateSavedSearch(savedSearchSchema)(req, {}, next);
    return { req, next };
  };

  it('replaces the body by the cleaned one and goes on', () => {
    const { req, next } = run({ q: '  sac  ', type: 'lost' });

    expect(req.body).toEqual({ q: 'sac', type: 'lost' });
    expect(next).toHaveBeenCalledWith();
  });

  it('passes a VALIDATION_ERROR with the faulty fields', () => {
    const { next } = run({ q: 'a', type: 'stolen' });

    const error = next.mock.calls[0][0];
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.map((d) => d.field).sort()).toEqual(['q', 'type']);
  });

  it('treats a missing body as empty', () => {
    const { next } = run(undefined);

    expect(next.mock.calls[0][0].code).toBe('VALIDATION_ERROR');
  });
});
