import { describe, expect, it } from 'vitest';
import {
  createReportBodySchema,
  listReportsQuerySchema,
  treatReportBodySchema,
} from '../../../src/validators/admin/report.validator.js';
import {
  declarationIdParamsSchema,
  moderationBodySchema,
} from '../../../src/validators/admin/moderation.validator.js';

const ID = '6a0000000000000000000001';

describe('report and moderation validators', () => {
  it('accepts a report with a known reason and no comment', () => {
    const { error } = createReportBodySchema.validate({ declarationId: ID, reason: 'duplicate' });
    expect(error).toBeUndefined();
  });

  it('refuses a reason that is not in the list', () => {
    const { error } = createReportBodySchema.validate({ declarationId: ID, reason: 'spam' });
    expect(error).toBeDefined();
  });

  it('refuses a declarationId that is not a 24-character hex id', () => {
    const { error } = createReportBodySchema.validate({ declarationId: 'abc', reason: 'other' });
    expect(error).toBeDefined();
  });

  it('refuses a comment longer than 500 characters', () => {
    const { error } = createReportBodySchema.validate({
      declarationId: ID,
      reason: 'other',
      comment: 'x'.repeat(501),
    });
    expect(error).toBeDefined();
  });

  it('defaults the report list to page 1 and 20 per page', () => {
    const { value } = listReportsQuerySchema.validate({});
    expect(value).toEqual({ page: 1, limit: 20 });
  });

  it('accepts treated and dismissed, and refuses open', () => {
    expect(treatReportBodySchema.validate({ status: 'treated' }).error).toBeUndefined();
    expect(treatReportBodySchema.validate({ status: 'dismissed' }).error).toBeUndefined();
    expect(treatReportBodySchema.validate({ status: 'open' }).error).toBeDefined();
  });

  it('requires a moderation reason of at least 3 characters after trimming', () => {
    expect(moderationBodySchema.validate({}).error).toBeDefined();
    expect(moderationBodySchema.validate({ reason: '  ab ' }).error).toBeDefined();
    expect(moderationBodySchema.validate({ reason: '  Spam  ' }).value.reason).toBe('Spam');
  });

  it('refuses a declaration id in the path that is malformed', () => {
    expect(declarationIdParamsSchema.validate({ id: 'nope' }).error).toBeDefined();
    expect(declarationIdParamsSchema.validate({ id: ID }).error).toBeUndefined();
  });
});
