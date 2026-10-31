// The event names are the contract between domains: the other binomes listen to them instead of
// importing our services, so renaming one breaks every listener.
export const EVENTS = Object.freeze({
  USER_DELETED: 'user.deleted',
  DECLARATION_CREATED: 'declaration.created',
  DECLARATION_UPDATED: 'declaration.updated',
  DECLARATION_STATUS_CHANGED: 'declaration.statusChanged',
});
