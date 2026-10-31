import { ValidationError } from '../../exceptions/app-error.js';

const SOURCES = ['body', 'params', 'query'];

// Unknown fields are rejected, not silently dropped, so a client sending role or status gets a
// 400 instead of believing it worked (mass assignment). convert is on because query and params
// values always arrive as strings.
const JOI_OPTIONS = Object.freeze({
  abortEarly: false,
  allowUnknown: false,
  stripUnknown: false,
  convert: true,
  errors: { wrap: { label: false } },
});

export function validate(schema, source = 'body') {
  // A wrong source is a coding mistake: fail when the route is defined, not on the first request.
  if (!SOURCES.includes(source)) {
    throw new Error(`validate(): source must be one of ${SOURCES.join(', ')}`);
  }

  return function validateMiddleware(req, res, next) {
    const { value, error } = schema.validate(req[source] ?? {}, JOI_OPTIONS);

    if (error) {
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));
      return next(new ValidationError('Invalid input', details));
    }

    // In Express 5 req.query is a getter without a setter, so a plain assignment would throw.
    // defineProperty replaces it with the cleaned value, for all three sources alike.
    Object.defineProperty(req, source, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    return next();
  };
}
