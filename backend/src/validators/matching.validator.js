import { ACTION, MATCH_STATUS } from '../constants/matching.constants.js';
import { ValidationError } from '../exceptions/matching.errors.js';

/**
 * Dependency-free validation (everything coming from the client is untrusted).
 * If the project uses Joi/Zod/express-validator, the rules below translate 1:1.
 */

const OBJECT_ID = /^[a-f\d]{24}$/i;

function assertObjectId(value, name = 'id') {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
    throw new ValidationError(`${name} must be a valid id`, [{ field: name, message: 'invalid id' }]);
  }
  return value;
}

function parseRespondBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Body must be a JSON object');
  }
  const errors = [];
  const allowed = new Set(['action', 'feedback']);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) errors.push({ field: k, message: 'unknown field' });
  }
  if (!Object.values(ACTION).includes(body.action)) {
    errors.push({ field: 'action', message: `must be one of: ${Object.values(ACTION).join(', ')}` });
  }
  let feedback = null;
  if (body.feedback !== undefined && body.feedback !== null) {
    if (typeof body.feedback !== 'string') {
      errors.push({ field: 'feedback', message: 'must be a string' });
    } else {
      feedback = body.feedback.trim();
      if (feedback.length > 1000) errors.push({ field: 'feedback', message: 'max 1000 characters' });
      if (feedback === '') feedback = null;
    }
  }
  if (body.action === ACTION.NEEDS_INFO && !feedback) {
    errors.push({ field: 'feedback', message: 'explain which information you need' });
  }
  if (errors.length) throw new ValidationError('Invalid body', errors);
  return { action: body.action, feedback };
}

function parseListQuery(query = {}, { allowDisputed = false } = {}) {
  const errors = [];
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) errors.push({ field: 'page', message: 'must be an integer >= 1' });
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    errors.push({ field: 'limit', message: 'must be an integer between 1 and 100' });
  }
  let status;
  if (query.status !== undefined) {
    if (!Object.values(MATCH_STATUS).includes(query.status)) {
      errors.push({ field: 'status', message: `must be one of: ${Object.values(MATCH_STATUS).join(', ')}` });
    } else status = query.status;
  }
  let disputed;
  if (allowDisputed && query.disputed !== undefined) {
    if (query.disputed !== 'true' && query.disputed !== 'false') {
      errors.push({ field: 'disputed', message: 'must be true or false' });
    } else disputed = query.disputed === 'true';
  }
  if (errors.length) throw new ValidationError('Invalid query', errors);
  return { page, limit, status, disputed };
}

export { assertObjectId, parseRespondBody, parseListQuery };