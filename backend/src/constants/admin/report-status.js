export const REPORT_STATUSES = Object.freeze({
  OPEN: 'open',
  TREATED: 'treated',
  DISMISSED: 'dismissed',
});

export const REPORT_STATUS_VALUES = Object.freeze(Object.values(REPORT_STATUSES));
export const DEFAULT_REPORT_STATUS = REPORT_STATUSES.OPEN;
