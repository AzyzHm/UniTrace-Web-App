export const AUDIT_ACTIONS = Object.freeze({
  REPORT_TREATED: 'report.treated',
  DECLARATION_HIDDEN: 'declaration.hidden',
  DECLARATION_RESTORED: 'declaration.restored',
  DECLARATION_DELETED: 'declaration.deleted',
  USER_SUSPENDED: 'user.suspended',
  USER_REACTIVATED: 'user.reactivated',
});

export const AUDIT_ACTION_VALUES = Object.freeze(Object.values(AUDIT_ACTIONS));
