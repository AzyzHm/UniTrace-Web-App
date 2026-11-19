/**
 * FICHIER : tests/unit/search/search-validator.test.js
 *
 * RÔLE
 *   Teste le schéma Joi de la query de recherche.
 *   Valeurs par défaut, conversions (texte -> nombre/booléen), status avec virgules, dates (dateTo seul, date avant dateFrom, fin de journée), refus des paramètres inconnus.
 *
 * TESTE
 *   src/validators/search/search.validator.js
 *
 * UTILISE
 *   vitest (describe/it/expect).
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/unit/search/search-validator.test.js
 */
import { describe, expect, it } from 'vitest';
import { searchQuerySchema } from '../../../src/validators/search/search.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false, convert: true };
const run = (query) => searchQuerySchema.validate(query, OPTIONS);

describe('search query schema', () => {
  it('applies the defaults to an empty query', () => {
    const { value, error } = run({});

    expect(error).toBeUndefined();
    expect(value).toEqual({ sort: 'date_desc', page: 1, limit: 20 });
  });

  it('converts numbers and booleans coming from the query string', () => {
    const { value, error } = run({ page: '2', limit: '10', hasPhoto: 'true' });

    expect(error).toBeUndefined();
    expect(value).toMatchObject({ page: 2, limit: 10, hasPhoto: true });
  });

  it('rejects an unknown parameter', () => {
    expect(run({ foo: 'bar' }).error).toBeDefined();
  });

  it.each([
    { limit: '999' },
    { page: '0' },
    { type: 'stolen' },
    { category: 'car' },
    { sort: 'x' },
  ])('rejects %o', (query) => {
    expect(run(query).error).toBeDefined();
  });

  it('accepts a short or empty q, the service ignores it', () => {
    expect(run({ q: 'a' }).error).toBeUndefined();
    expect(run({ q: '' }).error).toBeUndefined();
  });

  it('rejects a q longer than 200 characters', () => {
    expect(run({ q: 'a'.repeat(201) }).error).toBeDefined();
  });

  describe('status', () => {
    it('accepts a repeated parameter', () => {
      expect(run({ status: ['pending', 'matched'] }).value.status).toEqual(['pending', 'matched']);
    });

    it('accepts a comma separated list and removes duplicates', () => {
      expect(run({ status: 'hidden, deleted,pending,hidden' }).value.status).toEqual([
        'hidden',
        'deleted',
        'pending',
      ]);
    });

    it('rejects an unknown status', () => {
      expect(run({ status: 'pending,archived' }).error).toBeDefined();
      expect(run({ status: '' }).error).toBeDefined();
    });
  });

  describe('dates', () => {
    it('accepts dateTo alone', () => {
      expect(run({ dateTo: '2026-10-31' }).error).toBeUndefined();
    });

    it('rejects dateTo before dateFrom', () => {
      expect(run({ dateFrom: '2026-10-20', dateTo: '2026-10-10' }).error).toBeDefined();
    });

    it('moves a date only dateTo to the end of that day', () => {
      const { value } = run({ dateTo: '2026-10-31' });

      expect(value.dateTo.toISOString()).toBe('2026-10-31T23:59:59.999Z');
    });

    it('keeps a dateTo that has a time', () => {
      const { value } = run({ dateTo: '2026-10-31T08:00:00Z' });

      expect(value.dateTo.toISOString()).toBe('2026-10-31T08:00:00.000Z');
    });
  });
});
