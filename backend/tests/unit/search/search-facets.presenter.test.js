/**
 * FICHIER : tests/unit/search/search-facets.presenter.test.js
 *
 * RÔLE
 *   Vérifie que le presenter des facettes transforme correctement les données brutes
 *   ({ _id, count }) en réponse lisible ({ key, label, count }) avec les libellés français.
 *
 * TESTE
 *   src/presenters/search/search-facets.presenter.js
 *
 * COMMENT LE LANCER
 *      npx vitest run tests/unit/search/search-facets.presenter.test.js
 */
import { describe, expect, it } from 'vitest';
import { toFacetsResponse } from '../../../src/presenters/search/search-facets.presenter.js';

describe('search-facets presenter', () => {
  it('ajoute le libellé français pour une catégorie', () => {
    const raw = { category: [{ _id: 'wallet_bag', count: 12 }] };
    const result = toFacetsResponse(raw);

    expect(result.category[0]).toEqual({
      key: 'wallet_bag',
      label: 'Portefeuille / sac',
      count: 12,
    });
  });

  it("garde la clé brute si aucun libellé n'est trouvé", () => {
    const raw = { category: [{ _id: 'unknown_category', count: 1 }] };
    const result = toFacetsResponse(raw);

    expect(result.category[0].label).toBe('unknown_category');
  });

  it('limite le nombre de valeurs par facette (MAX_FACET_VALUES = 20)', () => {
    // On crée 30 valeurs pour la même facette
    const raw = {
      category: Array.from({ length: 30 }, (_, i) => ({
        _id: `cat_${i}`,
        count: 1,
      })),
    };
    const result = toFacetsResponse(raw);

    // Doit être limité à 20
    expect(result.category).toHaveLength(20);
  });

  it('gère un objet vide', () => {
    expect(toFacetsResponse({})).toEqual({});
  });

  it("ne modifie pas l'ordre (tri déjà fait par MongoDB)", () => {
    const raw = {
      type: [
        { _id: 'lost', count: 18 },
        { _id: 'found', count: 14 },
      ],
    };
    const result = toFacetsResponse(raw);

    expect(result.type.map((f) => f.key)).toEqual(['lost', 'found']);
  });
});
