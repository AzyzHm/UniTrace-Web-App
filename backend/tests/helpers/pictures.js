// The picture check reads only the first bytes, so a fake image is a valid header plus filler.
const pad = (head, size) => Buffer.concat([Buffer.from(head), Buffer.alloc(size - head.length, 1)]);

export const makeJpeg = (size = 64) => pad([0xff, 0xd8, 0xff, 0xe0], size);

export const makePng = (size = 64) => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], size);

// RIFF, four size bytes left at zero, then WEBP: the detector checks only RIFF at 0 and WEBP at 8.
export const makeWebp = (size = 64) =>
  pad([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], size);

// Not an image: sent under an image file name to prove the check looks at the bytes.
export const makeScript = () => Buffer.from('<script>alert(1)</script>');

// One byte over the 5 MB limit (PICTURE.MAX_BYTES).
export const makeOversizedPng = () => makePng(5 * 1024 * 1024 + 1);
