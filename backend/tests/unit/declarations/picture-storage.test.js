import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPictureStorage } from '../../../src/services/declarations/picture-storage.js';
import { makePng } from '../../helpers/pictures.js';

describe('picture storage', () => {
  let dir;
  let storage;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'unitrace-storage-'));
    storage = createPictureStorage({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('needs a folder', () => {
    expect(() => createPictureStorage({})).toThrow(/dir is required/);
  });

  it('saves the bytes under a random name and returns that name', async () => {
    const buffer = makePng();

    const filename = await storage.save({ buffer, ext: 'png' });

    expect(filename).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(readFileSync(path.join(dir, filename))).toEqual(buffer);
  });

  it('gives two saves two different names', async () => {
    const first = await storage.save({ buffer: makePng(), ext: 'png' });
    const second = await storage.save({ buffer: makePng(), ext: 'png' });

    expect(first).not.toBe(second);
  });

  it('creates the folder when it does not exist yet', async () => {
    const nested = path.join(dir, 'a', 'b');
    const filename = await createPictureStorage({ dir: nested }).save({
      buffer: makePng(),
      ext: 'png',
    });

    expect(existsSync(path.join(nested, filename))).toBe(true);
  });

  // randomName is forced to repeat to simulate a collision. The file is opened with the 'wx' flag,
  // so the second save fails instead of replacing the first.
  it('never overwrites a file that already has the name', async () => {
    const fixed = createPictureStorage({ dir, randomName: () => 'a'.repeat(32) });
    await fixed.save({ buffer: makePng(), ext: 'png' });

    await expect(fixed.save({ buffer: makePng(), ext: 'png' })).rejects.toMatchObject({
      code: 'EEXIST',
    });
  });

  it('refuses an extension that is not an image type', async () => {
    await expect(storage.save({ buffer: makePng(), ext: 'js' })).rejects.toThrow(/unsupported/);
    expect(existsSync(path.join(dir, `${'a'.repeat(32)}.js`))).toBe(false);
  });

  // resolve() rejects anything not shaped like its own file names, which blocks path traversal.
  it('resolves only names it could have produced', async () => {
    const filename = await storage.save({ buffer: makePng(), ext: 'webp' });

    expect(storage.resolve(filename)).toBe(path.join(dir, filename));
    for (const bad of ['../secret.png', 'a.png', `${'a'.repeat(32)}.exe`, '', null, undefined]) {
      expect(storage.resolve(bad)).toBeNull();
    }
  });

  it('knows the content type of a stored name', () => {
    expect(storage.contentTypeOf(`${'a'.repeat(32)}.jpg`)).toBe('image/jpeg');
    expect(storage.contentTypeOf(`${'a'.repeat(32)}.png`)).toBe('image/png');
    expect(storage.contentTypeOf(`${'a'.repeat(32)}.webp`)).toBe('image/webp');
    expect(storage.contentTypeOf('x.png')).toBeNull();
  });

  describe('remove', () => {
    it('deletes the file', async () => {
      const filename = await storage.save({ buffer: makePng(), ext: 'png' });

      await storage.remove(filename);

      expect(existsSync(path.join(dir, filename))).toBe(false);
    });

    it('is fine with a file that is already gone', async () => {
      await expect(storage.remove(`${'b'.repeat(32)}.png`)).resolves.toBeUndefined();
    });

    it('ignores a name that is not one of its own', async () => {
      await expect(storage.remove('../keep.txt')).resolves.toBeUndefined();
    });

    it('never throws, it logs a failure other than "not found"', async () => {
      const logger = { warn: vi.fn() };
      const broken = createPictureStorage({ dir, logger });
      // A folder with the shape of a picture name: unlink fails (EISDIR or EPERM).
      const name = `${'c'.repeat(32)}.png`;
      mkdirSync(path.join(dir, name));

      await expect(broken.remove(name)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });
});
