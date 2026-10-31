import { describe, expect, it } from 'vitest';
import { DECLARATION_STATUS_VALUES } from '../../../src/constants/declarations/declaration-status.js';
import {
  canTransition,
  getAllowedTransitions,
} from '../../../src/constants/declarations/transitions.js';

const ACTORS = ['user', 'admin', 'system'];

// [from, to, actors allowed]
const ALLOWED = [
  ['pending', 'matched', ['system']],
  ['pending', 'resolved', ['user', 'admin']],
  ['pending', 'expired', ['system']],
  ['pending', 'hidden', ['admin']],
  ['pending', 'deleted', ['user', 'admin']],
  ['matched', 'pending', ['system']],
  ['matched', 'resolved', ['user', 'admin']],
  ['matched', 'hidden', ['admin']],
  ['matched', 'deleted', ['user', 'admin']],
  ['resolved', 'pending', ['admin']],
  ['resolved', 'hidden', ['admin']],
  ['resolved', 'deleted', ['admin']],
  ['expired', 'pending', ['user', 'admin']],
  ['expired', 'deleted', ['user', 'admin']],
  ['hidden', 'pending', ['admin']],
  ['hidden', 'matched', ['admin']],
  ['hidden', 'resolved', ['admin']],
  ['hidden', 'deleted', ['admin']],
];

describe('canTransition', () => {
  it('matches the allowed table for every status pair and actor', () => {
    for (const from of DECLARATION_STATUS_VALUES) {
      for (const to of DECLARATION_STATUS_VALUES) {
        for (const actor of ACTORS) {
          const rule = ALLOWED.find(([f, t]) => f === from && t === to);
          const expected = rule ? rule[2].includes(actor) : false;

          expect(canTransition(from, to, actor), `${from} -> ${to} by ${actor}`).toBe(expected);
        }
      }
    }
  });

  it('lets only the system set matched', () => {
    expect(canTransition('pending', 'matched', 'system')).toBe(true);
    expect(canTransition('pending', 'matched', 'user')).toBe(false);
    expect(canTransition('pending', 'matched', 'admin')).toBe(false);
  });

  it('keeps resolved final for users but reopenable by an admin', () => {
    expect(canTransition('resolved', 'pending', 'user')).toBe(false);
    expect(canTransition('resolved', 'pending', 'admin')).toBe(true);
  });

  it('lets an admin, and only an admin, hide or delete a resolved declaration', () => {
    for (const to of ['hidden', 'deleted']) {
      expect(canTransition('resolved', to, 'admin')).toBe(true);
      expect(canTransition('resolved', to, 'user')).toBe(false);
      expect(canTransition('resolved', to, 'system')).toBe(false);
    }
  });

  it('lets an admin restore a hidden declaration to any status it can be hidden from', () => {
    for (const to of ['pending', 'matched', 'resolved']) {
      expect(canTransition('hidden', to, 'admin')).toBe(true);
    }
  });

  it('keeps deleted final for everyone', () => {
    for (const to of DECLARATION_STATUS_VALUES) {
      for (const actor of ACTORS) {
        expect(canTransition('deleted', to, actor)).toBe(false);
      }
    }
  });

  it('refuses a transition to the same status', () => {
    expect(canTransition('pending', 'pending', 'admin')).toBe(false);
  });

  it('refuses unknown statuses and unknown actors', () => {
    expect(canTransition('pending', 'banana', 'admin')).toBe(false);
    expect(canTransition('banana', 'pending', 'admin')).toBe(false);
    expect(canTransition('pending', 'resolved', 'visitor')).toBe(false);
    expect(canTransition(undefined, undefined, undefined)).toBe(false);
  });
});

describe('getAllowedTransitions', () => {
  it('lists what an owner can do from pending', () => {
    expect(getAllowedTransitions('pending', 'user').sort()).toEqual(['deleted', 'resolved']);
  });

  it('lists what an admin can do from hidden', () => {
    expect(getAllowedTransitions('hidden', 'admin').sort()).toEqual([
      'deleted',
      'matched',
      'pending',
      'resolved',
    ]);
  });

  it('returns an empty list from a final status', () => {
    expect(getAllowedTransitions('deleted', 'admin')).toEqual([]);
  });
});
