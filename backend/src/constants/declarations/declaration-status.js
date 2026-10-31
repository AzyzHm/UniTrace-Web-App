export const DECLARATION_STATUSES = Object.freeze({
  PENDING: 'pending',
  MATCHED: 'matched',
  RESOLVED: 'resolved',
  EXPIRED: 'expired',
  HIDDEN: 'hidden',
  DELETED: 'deleted',
});

export const DECLARATION_STATUS_VALUES = Object.freeze(Object.values(DECLARATION_STATUSES));
export const DEFAULT_DECLARATION_STATUS = DECLARATION_STATUSES.PENDING;
