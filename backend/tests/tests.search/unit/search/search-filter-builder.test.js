/**
 * FICHIER : tests/unit/search/search-filter-builder.test.js
 *
 * RÔLE
 *   Teste la fabrication du filtre MongoDB et la regex insensible aux accents.
 *   Aucune base de données : on compare l'objet filtre obtenu à l'objet attendu.
 *
 * TESTE
 *   src/services/search/search-filter-builder.js
 *
 * UTILISE
 *   vitest (describe/it/expect).
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/unit/search/search-filter-builder.test.js
 */
import { describe, expect, it } from 'vitest';
import {
  buildAccentInsensitiveRegex,
  buildSearchFilter,
} from '../../../src/services/search/search-filter-builder.js';

const ACTIVE = ['pending', 'matched'];

describe('buildSearchFilter', () => {
  it('only filters on the statuses and hides soft deleted declarations by default', () => {
    expect(buildSearchFilter({ statuses: ACTIVE })).toEqual({
      status: { $in: ACTIVE },
      deletedAt: null,
    });
  });

  it('does not require deletedAt to be empty when the deleted status is asked for', () => {
    const filter = buildSearchFilter({ statuses: ['deleted'] });

    expect(filter).toEqual({ status: { $in: ['deleted'] } });
  });

  it('combines every structured filter and the text query', () => {
    const dateFrom = new Date('2026-10-01T00:00:00Z');
    const dateTo = new Date('2026-10-31T23:59:59.999Z');

    const filter = buildSearchFilter({
      statuses: ACTIVE,
      type: 'found',
      category: 'wallet_bag',
      location: 'BU',
      color: 'black',
      dateFrom,
      dateTo,
      q: 'sac noir',
    });

    expect(filter).toEqual({
      status: { $in: ACTIVE },
      deletedAt: null,
      type: 'found',
      category: 'wallet_bag',
      location: 'BU',
      'attributes.color': 'black',
      date: { $gte: dateFrom, $lte: dateTo },
      $text: { $search: 'sac noir' },
    });
  });

  it('uses only the bound that is given', () => {
    const dateFrom = new Date('2026-10-01T00:00:00Z');

    expect(buildSearchFilter({ statuses: ACTIVE, dateFrom }).date).toEqual({ $gte: dateFrom });
  });

  it('uses a regex for the loose location match', () => {
    const { location } = buildSearchFilter({
      statuses: ACTIVE,
      location: 'bibliotheque',
      locationMode: 'loose',
    });

    expect(location.$options).toBe('i');
    expect(new RegExp(location.$regex, 'i').test('Bibliothèque, 2e étage')).toBe(true);
  });

  describe('hasPhoto', () => {
    it('keeps the pictures a user can see: a sensitive category does not count', () => {
      const { $and } = buildSearchFilter({ statuses: ACTIVE, hasPhoto: true });

      expect($and).toEqual([
        { picture: { $ne: null } },
        { category: { $nin: ['student_card_id'] } },
      ]);
    });

    it('also returns the sensitive categories when asking for no photo', () => {
      const { $and } = buildSearchFilter({ statuses: ACTIVE, hasPhoto: false });

      expect($and).toEqual([
        { $or: [{ picture: null }, { category: { $in: ['student_card_id'] } }] },
      ]);
    });

    it('leaves the filter alone when not given', () => {
      expect(buildSearchFilter({ statuses: ACTIVE })).not.toHaveProperty('$and');
    });
  });
});

describe('buildAccentInsensitiveRegex', () => {
  const matches = (input, text) => new RegExp(buildAccentInsensitiveRegex(input), 'i').test(text);

  it('ignores accents on both sides', () => {
    expect(matches('amphitheatre', 'Amphithéâtre A')).toBe(true);
    expect(matches('Amphithéâtre', 'amphitheatre a')).toBe(true);
    expect(matches('ecole', 'École doctorale')).toBe(true);
  });

  it('matches a part of the text', () => {
    expect(matches('biblio', 'Main library / Bibliothèque')).toBe(true);
  });

  it('escapes regex syntax typed by the user', () => {
    expect(buildAccentInsensitiveRegex('a.b*(c)')).not.toMatch(/(^|[^\\])[.*()]/);
    expect(matches('a.b', 'axb')).toBe(false);
    expect(matches('(x', '(x')).toBe(true);
  });
});
