/**
 * FICHIER : tests/unit/search/filter-labels.test.js
 *
 * RÔLE
 *   Vérifie qu'aucun type, catégorie ou statut n'a été oublié dans le dictionnaire français.
 *   Évite d'afficher 'undefined' dans une liste déroulante si on ajoute une catégorie plus tard.
 *
 * TESTE
 *   src/constants/search/filter-labels.js
 *
 * UTILISE
 *   vitest (describe/it/expect).
 *
 * COMMENT LE LANCER
 *   npx vitest run tests/unit/search/filter-labels.test.js
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_KEYS } from '../../../src/constants/declarations/categories.js';
import { DECLARATION_STATUS_VALUES } from '../../../src/constants/declarations/declaration-status.js';
import { DECLARATION_TYPE_VALUES } from '../../../src/constants/declarations/declaration-types.js';
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
} from '../../../src/constants/search/filter-labels.js';

// A new category or status without a French label would show "undefined" in the dropdown.
describe('search filter labels', () => {
  it.each([
    ['types', TYPE_LABELS, DECLARATION_TYPE_VALUES],
    ['categories', CATEGORY_LABELS, CATEGORY_KEYS],
    ['statuses', STATUS_LABELS, DECLARATION_STATUS_VALUES],
  ])('has a label for every one of the %s, and no more', (_name, labels, keys) => {
    expect(Object.keys(labels).sort()).toEqual([...keys].sort());
  });
});
