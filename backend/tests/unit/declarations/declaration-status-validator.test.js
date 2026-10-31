import { describe, expect, it } from 'vitest';
import { changeDeclarationStatusSchema } from '../../../src/validators/declarations/declaration.validator.js';

const OPTIONS = { abortEarly: false, allowUnknown: false, convert: true };

const run = (body) => changeDeclarationStatusSchema.validate(body, OPTIONS);
const messages = (body) => {
  const { error } = run(body);
  return error ? error.details.map((d) => `${d.path.join('.')}: ${d.message}`) : [];
};

describe('change declaration status schema', () => {
  it.each(['pending', 'matched', 'resolved', 'expired', 'hidden', 'deleted'])(
    'accepts the known status %s',
    (status) => {
      const { value, error } = run({ status });

      expect(error).toBeUndefined();
      expect(value).toEqual({ status });
    },
  );

  it('refuses a status that does not exist', () => {
    expect(messages({ status: 'archived' })).toEqual([
      'status: "status" must be one of [pending, matched, resolved, expired, hidden, deleted]',
    ]);
  });

  it('is case sensitive', () => {
    expect(messages({ status: 'Resolved' })).toHaveLength(1);
  });

  it('refuses a missing status', () => {
    expect(messages({})).toEqual(['status: "status" is required']);
  });

  it.each([
    ['a number', 1],
    ['null', null],
    ['an object', { $ne: 'deleted' }],
    ['an array', ['resolved']],
    ['an empty string', ''],
  ])('refuses a status that is %s', (_label, status) => {
    const found = messages({ status });

    expect(found.length).toBeGreaterThan(0);
    expect(found.every((message) => message.startsWith('status: '))).toBe(true);
  });

  it.each(['owner', 'deletedAt', 'statusBeforeHidden', 'privateInfo', 'title'])(
    'refuses %s in the body',
    (field) => {
      expect(messages({ status: 'resolved', [field]: 'x' })).toEqual([
        `${field}: "${field}" is not allowed`,
      ]);
    },
  );
});
