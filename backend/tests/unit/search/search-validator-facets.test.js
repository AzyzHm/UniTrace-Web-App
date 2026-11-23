/**
 * FICHIER : tests/unit/search/search-validator-facets.test.js
 *
 * RÔLE
 *   Vérifie que le schéma Joi accepte les facettes valides, refuse les inconnues,
 *   dédoublonne les valeurs et limite le nombre de facettes.
 *
 * TESTE
 *   src/validators/search/search.validator.js
 *
 * COMMENT LE LANCER
 *      npx vitest run tests/unit/search/search-validator-facets.test.js
 */
import { describe, expect, it } from 'vitest';
import { searchQuerySchema } from '../../../src/validators/search/search.validator.js';

describe('search query validator - facets', () => {
  it('accepte une seule facette valide', () => {
    const { error, value } = searchQuerySchema.validate({ facets: 'category' });
    expect(error).toBeUndefined();
    expect(value.facets).toEqual(['category']);
  });

  it('accepte plusieurs facettes séparées par des virgules', () => {
    const { error, value } = searchQuerySchema.validate({ facets: 'category,type,status' });
    expect(error).toBeUndefined();
    expect(value.facets).toEqual(['category', 'type', 'status']);
  });

  it('accepte les facettes répétées (dédoublonnage)', () => {
    const { error, value } = searchQuerySchema.validate({
      facets: ['category', 'category', 'type'],
    });
    expect(error).toBeUndefined();
    expect(value.facets).toEqual(['category', 'type']);
  });

  it('refuse une facette inconnue', () => {
    const { error } = searchQuerySchema.validate({ facets: 'unknown' });
    expect(error).toBeDefined();
    expect(error.details[0].message).toContain('facets must be one or more of');
  });

  it('refuse une combinaison contenant une facette inconnue', () => {
    const { error } = searchQuerySchema.validate({ facets: 'category,unknown' });
    expect(error).toBeDefined();
    expect(error.details[0].message).toContain('facets must be one or more of');
  });

  it('accepte exactement 3 facettes valides (limite atteinte)', () => {
    const { error, value } = searchQuerySchema.validate({ facets: 'category,type,status' });
    expect(error).toBeUndefined();
    expect(value.facets).toHaveLength(3);
  });

  // Note : il n'existe que 3 facettes autorisées (category, type, status).
  // On ne peut donc pas tester "plus de 3" avec des valeurs valides.
  // Ce test sera réactivé si on ajoute une 4e facette dans FACET_VALUES.
});
