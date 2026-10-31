import { ValidationError } from '../../exceptions/app-error.js';

const SOURCES = ['body', 'params', 'query'];

const JOI_OPTIONS = Object.freeze({
  abortEarly: false,
  allowUnknown: false,
  stripUnknown: false,
  convert: true,
  errors: { wrap: { label: false } },
});

export function validate(schema, source = 'body') {
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

    Object.defineProperty(req, source, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    return next();
  };
}
