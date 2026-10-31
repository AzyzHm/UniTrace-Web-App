export const ROLES = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
});

export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

// Not a role: no account can have it. It names the automatic actor (matching, expiry, cleanup)
// in the transition table, so a user can never be treated as the system.
export const SYSTEM_ACTOR = 'system';

export function isAdminRole(role) {
  return role === ROLES.ADMIN;
}
