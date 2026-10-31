import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_KEYS } from '../../../src/constants/declarations/categories.js';
import { DECLARATION_STATUS_VALUES } from '../../../src/constants/declarations/declaration-status.js';
import { EVENTS } from '../../../src/constants/common/events.js';
import { ROLE_VALUES, isAdminRole } from '../../../src/constants/common/roles.js';

describe('constants', () => {
  it('exposes the frozen status list', () => {
    expect(DECLARATION_STATUS_VALUES).toEqual([
      'pending',
      'matched',
      'resolved',
      'expired',
      'hidden',
      'deleted',
    ]);
  });

  it('exposes the two roles', () => {
    expect(ROLE_VALUES).toEqual(['user', 'admin']);
  });

  it('treats only admin as an admin role', () => {
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('user')).toBe(false);
    expect(isAdminRole('system')).toBe(false);
  });

  it('has 14 categories, each with a label', () => {
    expect(CATEGORY_KEYS).toHaveLength(14);
    for (const key of CATEGORY_KEYS) {
      expect(CATEGORIES[key].label).toBeTruthy();
    }
  });

  it('flags student cards as sensitive and phones as high value', () => {
    expect(CATEGORIES.student_card_id.sensitive).toBe(true);
    expect(CATEGORIES.phone.highValue).toBe(true);
  });

  it('names the four events of the contract with the other binomes', () => {
    expect(EVENTS).toEqual({
      USER_DELETED: 'user.deleted',
      DECLARATION_CREATED: 'declaration.created',
      DECLARATION_UPDATED: 'declaration.updated',
      DECLARATION_STATUS_CHANGED: 'declaration.statusChanged',
    });
    expect(Object.isFrozen(EVENTS)).toBe(true);
  });

  it('cannot be mutated', () => {
    expect(Object.isFrozen(CATEGORIES)).toBe(true);
    expect(Object.isFrozen(ROLE_VALUES)).toBe(true);
  });
});
