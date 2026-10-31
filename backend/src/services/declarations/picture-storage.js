import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PICTURE_MIME_BY_EXTENSION, PICTURE_TYPES } from '../../constants/declarations/picture.js';

// Names are generated here, so anything else is refused. This is what blocks path
// traversal in resolve and remove.
const FILENAME_PATTERN = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

const silentLogger = { warn() {} };

export function createPictureStorage({
  dir,
  logger = silentLogger,
  randomName = () => randomBytes(16).toString('hex'),
}) {
  if (!dir) throw new Error('createPictureStorage(): dir is required');

  const root = path.resolve(dir);
  const isValidName = (filename) => typeof filename === 'string' && FILENAME_PATTERN.test(filename);

  return {
    dir: root,

    async save({ buffer, ext }) {
      if (!Object.values(PICTURE_TYPES).includes(ext)) {
        throw new Error(`createPictureStorage(): unsupported extension "${ext}"`);
      }

      const filename = `${randomName()}.${ext}`;
      await mkdir(root, { recursive: true });
      // 'wx' fails if the file exists: a name collision can never overwrite a picture.
      await writeFile(path.join(root, filename), buffer, { flag: 'wx' });
      return filename;
    },

    resolve(filename) {
      return isValidName(filename) ? path.join(root, filename) : null;
    },

    contentTypeOf(filename) {
      return isValidName(filename) ? PICTURE_MIME_BY_EXTENSION[filename.split('.')[1]] : null;
    },

    async remove(filename) {
      if (!isValidName(filename)) return;

      try {
        await unlink(path.join(root, filename));
      } catch (err) {
        // A missing file is already the wanted result.
        if (err.code !== 'ENOENT') {
          logger.warn({ err, filename }, 'Could not delete a picture file');
        }
      }
    },
  };
}
