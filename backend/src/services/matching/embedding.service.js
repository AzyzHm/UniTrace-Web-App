import { MATCHING_CONFIG } from '../../constants/matching/matching-config.js';

export function createEmbeddingService({ pictureStorage, logger, config = MATCHING_CONFIG }) {
  if (!pictureStorage) throw new Error('createEmbeddingService(): pictureStorage is required');

  let lib;
  let textPipe;
  let imageModel;
  let imageProcessor;
  let imageReady;
  const transformers = async () => (lib ??= await import('@xenova/transformers'));

  async function getTextPipe() {
    textPipe ??= await (await transformers()).pipeline('feature-extraction', config.TEXT_MODEL);
    return textPipe;
  }

  // The promise is stored, so two calls arriving during the load share the same load.
  function loadImage() {
    imageReady ??= (async () => {
      const t = await transformers();
      imageProcessor = await t.AutoProcessor.from_pretrained(config.IMAGE_MODEL);
      imageModel = await t.CLIPVisionModelWithProjection.from_pretrained(config.IMAGE_MODEL);
      logger?.info({ model: config.IMAGE_MODEL }, 'Matching image model ready');
    })().catch((err) => {
      imageReady = undefined; // allow a retry after a failure
      throw err;
    });
    return imageReady;
  }

  return {
    async embedText(text) {
      const out = await (await getTextPipe())(text, { pooling: 'mean', normalize: true });
      return Array.from(out.data);
    },

    async embedImage(filename) {
      // resolve() returns null for any name it did not generate: no path traversal possible.
      const filePath = pictureStorage.resolve(filename);
      if (!filePath) throw new Error('Invalid picture filename');

      await loadImage();
      const t = await transformers();
      const image = await t.RawImage.read(filePath);
      const { image_embeds } = await imageModel(await imageProcessor(image));
      const vector = Array.from(image_embeds.data);
      const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0)) || 1;
      const result = vector.map((x) => x / norm);

      logger?.info(
        { file: filename, dimensions: result.length, normBefore: Number(norm.toFixed(3)) },
        'Image embedded',
      );
      return result;
    },

    // Loads both models at startup so the first declaration is not slow.
    async warmup() {
      await getTextPipe();
      logger?.info('Matching text model ready');
      try {
        await loadImage();
      } catch (err) {
        logger?.error({ err }, 'Matching image model failed to load');
      }
    },
  };
}
