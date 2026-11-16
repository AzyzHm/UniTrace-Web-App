import { describe, expect, it } from 'vitest';
import {
  REPORT_REASONS,
  REPORT_REASON_VALUES,
} from '../../../src/constants/admin/report-reasons.js';
import {
  DEFAULT_REPORT_STATUS,
  REPORT_STATUSES,
  REPORT_STATUS_VALUES,
} from '../../../src/constants/admin/report-status.js';
import { AUDIT_ACTIONS, AUDIT_ACTION_VALUES } from '../../../src/constants/admin/audit-actions.js';
import { EVENTS } from '../../../src/constants/common/events.js';

describe('admin constants', () => {
  it('lists the five report reasons from the study', () => {
    expect(REPORT_REASON_VALUES).toHaveLength(5);
    expect(REPORT_REASON_VALUES).toEqual(Object.values(REPORT_REASONS));
    expect(REPORT_REASON_VALUES).toEqual(
      expect.arrayContaining([
        'false_declaration',
        'inappropriate_content',
        'duplicate',
        'incorrect_information',
        'other',
      ]),
    );
  });

  it('has open, treated and dismissed report statuses, open by default', () => {
    expect(REPORT_STATUS_VALUES).toEqual(['open', 'treated', 'dismissed']);
    expect(DEFAULT_REPORT_STATUS).toBe(REPORT_STATUSES.OPEN);
  });

  it('gives every audit action a unique name', () => {
    expect(new Set(AUDIT_ACTION_VALUES).size).toBe(AUDIT_ACTION_VALUES.length);
    expect(AUDIT_ACTIONS.USER_SUSPENDED).toBe('user.suspended');
  });

  it('registers the admin events', () => {
    expect(EVENTS.USER_SUSPENDED).toBe('user.suspended');
    expect(EVENTS.USER_REACTIVATED).toBe('user.reactivated');
    expect(EVENTS.REPORT_CREATED).toBe('report.created');
    expect(EVENTS.REPORT_TREATED).toBe('report.treated');
  });

  it('freezes the objects so nothing can change them at runtime', () => {
    expect(Object.isFrozen(REPORT_REASONS)).toBe(true);
    expect(Object.isFrozen(REPORT_STATUSES)).toBe(true);
    expect(Object.isFrozen(AUDIT_ACTIONS)).toBe(true);
  });
});
