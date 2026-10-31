export const PICTURE = Object.freeze({
  FIELD_NAME: 'picture',
  MAX_BYTES: 5 * 1024 * 1024,
});

// Allowlist of accepted image types. The stored extension comes from this table, applied to the
// type detected in the file content, never from the name or type the client claims.
export const PICTURE_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export const PICTURE_MIME_BY_EXTENSION = Object.freeze(
  Object.fromEntries(Object.entries(PICTURE_TYPES).map(([mime, ext]) => [ext, mime])),
);

// Pictures are served by an authenticated route, not from a public folder, so they follow the
// same visibility rules as the declaration they belong to.
export const PICTURE_URL_BASE = '/api/v1/declarations';
