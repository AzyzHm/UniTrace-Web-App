export const PICTURE = Object.freeze({
  FIELD_NAME: 'picture',
  MAX_BYTES: 5 * 1024 * 1024,
});

export const PICTURE_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export const PICTURE_MIME_BY_EXTENSION = Object.freeze(
  Object.fromEntries(Object.entries(PICTURE_TYPES).map(([mime, ext]) => [ext, mime])),
);

export const PICTURE_URL_BASE = '/api/v1/declarations';
