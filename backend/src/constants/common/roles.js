export const ROLES = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
});

export const ROLE_VALUES = Object.freeze(Object.values(ROLES));
export const SYSTEM_ACTOR = 'system';

export function isAdminRole(role) {
  return role === ROLES.ADMIN;
}
