// Names written in the audit log. One per admin action, so the history can be read by machine.
export const AUDIT_ACTIONS = Object.freeze({
  REPORT_TREATED: 'report.treated',
  DECLARATION_HIDDEN: 'declaration.hidden',
  DECLARATION_RESTORED: 'declaration.restored',
  DECLARATION_DELETED: 'declaration.deleted',
  USER_DELETED: 'user.deleted',
});

export const AUDIT_ACTION_VALUES = Object.freeze(Object.values(AUDIT_ACTIONS));
