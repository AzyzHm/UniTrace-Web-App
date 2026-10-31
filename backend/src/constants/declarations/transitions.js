import { DECLARATION_STATUSES as S } from './declaration-status.js';
import { ROLES, SYSTEM_ACTOR } from '../common/roles.js';

const { USER, ADMIN } = ROLES;

const TRANSITIONS = Object.freeze({
  [S.PENDING]: {
    [S.MATCHED]: [SYSTEM_ACTOR],
    [S.RESOLVED]: [USER, ADMIN],
    [S.EXPIRED]: [SYSTEM_ACTOR],
    [S.HIDDEN]: [ADMIN],
    [S.DELETED]: [USER, ADMIN],
  },
  [S.MATCHED]: {
    [S.PENDING]: [SYSTEM_ACTOR],
    [S.RESOLVED]: [USER, ADMIN],
    [S.HIDDEN]: [ADMIN],
    [S.DELETED]: [USER, ADMIN],
  },
  [S.RESOLVED]: {
    [S.PENDING]: [ADMIN],
    [S.HIDDEN]: [ADMIN],
    [S.DELETED]: [ADMIN],
  },
  [S.EXPIRED]: {
    [S.PENDING]: [USER, ADMIN],
    [S.DELETED]: [USER, ADMIN],
  },
  [S.HIDDEN]: {
    [S.PENDING]: [ADMIN],
    [S.MATCHED]: [ADMIN],
    [S.RESOLVED]: [ADMIN],
    [S.DELETED]: [ADMIN],
  },
  [S.DELETED]: {},
});

export function canTransition(from, to, role) {
  const allowedActors = TRANSITIONS[from]?.[to];
  if (!allowedActors) return false;
  return allowedActors.includes(role);
}

export function getAllowedTransitions(from, role) {
  const targets = TRANSITIONS[from] ?? {};
  return Object.keys(targets).filter((to) => canTransition(from, to, role));
}
