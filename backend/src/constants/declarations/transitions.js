import { DECLARATION_STATUSES as S } from './declaration-status.js';
import { ROLES, SYSTEM_ACTOR } from '../common/roles.js';

const { USER, ADMIN } = ROLES;

// The single source of truth for status changes: TRANSITIONS[from][to] lists who may make the
// move. Every service reads this table (and the frontend learns the result through
// allowedTransitions), so the rules cannot differ from one route to another.
const TRANSITIONS = Object.freeze({
  [S.PENDING]: {
    // Only the system sets matched and expired: a user cannot claim a match or expire a
    // declaration by hand.
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
  // A resolved declaration is history: the owner cannot reopen or delete it, only an admin can.
  [S.RESOLVED]: {
    [S.PENDING]: [ADMIN],
    [S.HIDDEN]: [ADMIN],
    [S.DELETED]: [ADMIN],
  },
  // The owner can renew an expired declaration, which puts it back in circulation.
  [S.EXPIRED]: {
    [S.PENDING]: [USER, ADMIN],
    [S.DELETED]: [USER, ADMIN],
  },
  // Hidden is a moderation state: only an admin can restore it, to pending, matched or resolved.
  [S.HIDDEN]: {
    [S.PENDING]: [ADMIN],
    [S.MATCHED]: [ADMIN],
    [S.RESOLVED]: [ADMIN],
    [S.DELETED]: [ADMIN],
  },
  // Final: nothing leaves this state.
  [S.DELETED]: {},
});

export function canTransition(from, to, role) {
  // An unknown status or a move that is not in the table is refused, never allowed by default.
  const allowedActors = TRANSITIONS[from]?.[to];
  if (!allowedActors) return false;
  return allowedActors.includes(role);
}

// Lets the details route tell the frontend which actions to offer, so it only shows buttons that
// will succeed.
export function getAllowedTransitions(from, role) {
  const targets = TRANSITIONS[from] ?? {};
  return Object.keys(targets).filter((to) => canTransition(from, to, role));
}
