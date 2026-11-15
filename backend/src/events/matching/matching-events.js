/**
 * THE ONLY PLACE WHERE EVENT NAMES ARE GUESSED.
 * Set DECLARATION_EVENTS to the names emitted by services/declarations/declaration.service.js
 * and by the account deletion (services/users/account-deletion.service.js).
 * An event that is never emitted is simply never received: nothing breaks.
 */
export const DECLARATION_EVENTS = {
  created: 'declaration.created',
  updated: 'declaration.updated',
  deleted: 'declaration.deleted',
  hidden: 'declaration.hidden',
  restored: 'declaration.restored',
  userDeleted: 'user.deleted', // account deleted
};

/** Events emitted BY the matching module (notifications for binôme 4 / the email service). */
export const MATCHING_EVENTS = {
  NOTIFICATION: 'matching.notification', // payload: { userId, type, matchId, data }
};