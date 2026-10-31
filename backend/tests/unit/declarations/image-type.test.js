import { describe, expect, it } from 'vitest';
import { detectImageType } from '../../../src/utils/declarations/image-type.js';
import { makeJpeg, makePng, makeScript, makeWebp } from '../../helpers/pictures.js';

describe('detectImageType', () => {
  it.each([
    ['jpeg', makeJpeg(), { mime: 'image/jpeg', ext: 'jpg' }],
    ['png', makePng(), { mime: 'image/png', ext: 'png' }],
    ['webp', makeWebp(), { mime: 'image/webp', ext: 'webp' }],
  ])('recognises a %s by its first bytes', (_name, buffer, expected) => {
    expect(detectImageType(buffer)).toEqual(expected);
  });

  it.each([
    ['a script', makeScript()],
    ['an empty file', Buffer.alloc(0)],
    ['a truncated png signature', Buffer.from([0x89, 0x50, 0x4e])],
    ['a gif', Buffer.from('GIF89a......')],
    ['a RIFF file that is not webp (a wav)', Buffer.from('RIFF\0\0\0\0WAVEfmt ')],
    ['a pdf', Buffer.from('%PDF-1.7')],
  ])('refuses %s', (_name, buffer) => {
    expect(detectImageType(buffer)).toBeNull();
  });

  it('refuses what is not a buffer', () => {
    expect(detectImageType(undefined)).toBeNull();
    expect(detectImageType('image/png')).toBeNull();
  });
});
