/**
 * FICHIER : tests/unit/search/saved-search-presenter-model.test.js
 *
 * RÔLE
 *   Teste, sans base de données, (1) ce que le presenter montre d'une recherche sauvegardée
 *   (jamais le propriétaire, critères vides retirés) et (2) les règles du modèle Mongoose
 *   (owner obligatoire, types et catégories valides, nom limité).
 *
 * TESTE
 *   presenters/search/saved-search.presenter.js, models/search/saved-search.model.js
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/unit/search/saved-search-presenter-model.test.js
 */
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { SavedSearch } from '../../../src/models/search/saved-search.model.js';
import { toSavedSearchResponse } from '../../../src/presenters/search/saved-search.presenter.js';

const ownerId = new mongoose.Types.ObjectId();

describe('toSavedSearchResponse', () => {
  it('shows id, name, criteria and date, and nothing else', () => {
    const response = toSavedSearchResponse({
      _id: '650000000000000000000001',
      owner: ownerId,
      __v: 0,
      name: 'Bag',
      criteria: { q: 'sac', type: 'lost' },
      createdAt: new Date('2026-11-01T00:00:00Z'),
      updatedAt: new Date('2026-11-02T00:00:00Z'),
    });

    expect(response).toEqual({
      id: '650000000000000000000001',
      name: 'Bag',
      criteria: { q: 'sac', type: 'lost' },
      createdAt: new Date('2026-11-01T00:00:00Z'),
    });
  });

  it('removes empty criteria but keeps false', () => {
    const response = toSavedSearchResponse({
      _id: 'x',
      criteria: { q: null, type: undefined, hasPhoto: false },
    });

    expect(response.criteria).toEqual({ hasPhoto: false });
  });

  it('answers a null name when there is none', () => {
    expect(toSavedSearchResponse({ _id: 'x', criteria: { type: 'lost' } }).name).toBeNull();
  });

  it('works with a Mongoose document too (id virtual, sub document)', () => {
    const doc = new SavedSearch({ owner: ownerId, criteria: { type: 'found', hasPhoto: false } });

    const response = toSavedSearchResponse(doc);

    expect(response.id).toBe(String(doc._id));
    expect(response.criteria).toEqual({ type: 'found', hasPhoto: false });
    expect(JSON.stringify(response)).not.toContain(String(ownerId));
  });
});

describe('SavedSearch model', () => {
  const valid = { owner: ownerId, criteria: { type: 'lost', category: 'keys', q: 'clés' } };

  it('accepts a valid document', () => {
    expect(new SavedSearch(valid).validateSync()).toBeUndefined();
  });

  it('requires an owner and criteria', () => {
    const error = new SavedSearch({}).validateSync();

    expect(Object.keys(error.errors).sort()).toEqual(['criteria', 'owner']);
  });

  it.each([
    ['an unknown type', { type: 'stolen' }, 'criteria.type'],
    ['an unknown category', { category: 'spaceship' }, 'criteria.category'],
  ])('refuses %s', (label, criteria, path) => {
    const error = new SavedSearch({ owner: ownerId, criteria }).validateSync();

    expect(error.errors[path]).toBeDefined();
  });

  it('refuses a name over 60 characters', () => {
    const error = new SavedSearch({ ...valid, name: 'x'.repeat(61) }).validateSync();

    expect(error.errors.name).toBeDefined();
  });

  it('has an index on owner and createdAt', () => {
    const keys = SavedSearch.schema.indexes().map(([key]) => key);

    expect(keys).toContainEqual({ owner: 1, createdAt: -1 });
  });
});
