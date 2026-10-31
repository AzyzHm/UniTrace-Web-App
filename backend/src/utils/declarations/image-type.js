import { PICTURE_TYPES } from '../../constants/declarations/picture.js';

// Only the first bytes are read: the file name and the Content-Type header are chosen by the
// client, so neither proves the file is an image.
const JPEG_START = [0xff, 0xd8, 0xff];
const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function asciiAt(buffer, offset, text) {
  return startsWith(
    buffer,
    [...text].map((char) => char.charCodeAt(0)),
    offset,
  );
}

export function detectImageType(buffer) {
  // Anything that is not a buffer is treated as "not an image".
  if (!Buffer.isBuffer(buffer)) return null;

  let mime = null;
  if (startsWith(buffer, JPEG_START)) mime = 'image/jpeg';
  else if (startsWith(buffer, PNG_START)) mime = 'image/png';
  // WebP is a RIFF container, like WAV and AVI, so 'WEBP' at byte 8 is what tells them apart.
  else if (asciiAt(buffer, 0, 'RIFF') && asciiAt(buffer, 8, 'WEBP')) mime = 'image/webp';

  return mime ? { mime, ext: PICTURE_TYPES[mime] } : null;
}
