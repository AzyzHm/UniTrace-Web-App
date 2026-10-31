import multer from 'multer';
import { FileTooLargeError, ValidationError } from '../../exceptions/app-error.js';
import { PICTURE } from '../../constants/declarations/picture.js';
import { detectImageType } from '../../utils/declarations/image-type.js';

const pictureError = (message) =>
  new ValidationError('Invalid input', [{ field: PICTURE.FIELD_NAME, message }]);

function toAppError(err) {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return new FileTooLargeError(
          `Picture is too large, the maximum is ${PICTURE.MAX_BYTES / (1024 * 1024)} MB`,
        );
      case 'LIMIT_UNEXPECTED_FILE':
        return new ValidationError('Invalid input', [
          {
            field: String(err.field ?? ''),
            message: `Unexpected file, the picture goes in the "${PICTURE.FIELD_NAME}" field`,
          },
        ]);
      case 'LIMIT_FILE_COUNT':
        return pictureError('Only one picture can be sent');
      default:
        return new ValidationError('Invalid input', [
          { field: '', message: 'Too many fields or a field that is too long' },
        ]);
    }
  }

  return new ValidationError('Malformed multipart body');
}

export function createUploadPicture() {
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: PICTURE.MAX_BYTES,
      files: 1,
      fields: 25,
      fieldSize: 8 * 1024,
    },
  }).single(PICTURE.FIELD_NAME);

  const run = (req, res) =>
    new Promise((resolve, reject) => {
      parse(req, res, (err) => (err ? reject(err) : resolve()));
    });

  return async function uploadPicture(req, res, next) {
    try {
      await run(req, res);
    } catch (err) {
      throw toAppError(err);
    }

    if (req.file) {
      const detected = detectImageType(req.file.buffer);
      if (!detected) throw pictureError('Picture must be a jpeg, png or webp image');

      req.picture = { buffer: req.file.buffer, mime: detected.mime, ext: detected.ext };
      delete req.file;
    }

    next();
  };
}

export function requirePicture(req, res, next) {
  if (!req.picture) throw pictureError('A picture is required');
  next();
}

export function parseMultipartAttributes(req, res, next) {
  if (req.is('multipart/form-data') && typeof req.body?.attributes === 'string') {
    try {
      req.body.attributes = JSON.parse(req.body.attributes);
    } catch {
      throw new ValidationError('Invalid input', [
        { field: 'attributes', message: 'Attributes must be a valid JSON object' },
      ]);
    }
  }

  next();
}
