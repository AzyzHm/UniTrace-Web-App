import { MATCHING_CONFIG } from '../../constants/matching/matching-config.js';

export function createEmbeddingService({ pictureStorage, logger, config = MATCHING_CONFIG }) {
  if (!pictureStorage) throw new Error('createEmbeddingService(): pictureStorage is required');

  let lib;
  let textPipe;
  let imageModel;
  let imageProcessor;
  const transformers = async () => (lib ??= await import('@xenova/transformers'));

  async function getTextPipe() {
    textPipe ??= await (await transformers()).pipeline('feature-extraction', config.TEXT_MODEL);
    return textPipe;
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

      const t = await transformers();
      if (!imageModel) {
        imageProcessor = await t.AutoProcessor.from_pretrained(config.IMAGE_MODEL);
        imageModel = await t.CLIPVisionModelWithProjection.from_pretrained(config.IMAGE_MODEL);
      }
      const image = await t.RawImage.read(filePath);
      const { image_embeds } = await imageModel(await imageProcessor(image));
      const vector = Array.from(image_embeds.data);
      const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0)) || 1;
      return vector.map((x) => x / norm);
    },

    // Loads the text model at startup so the first declaration is not slow (about 40 s).
    async warmup() {
      await getTextPipe();
      logger?.info('Matching text model ready');
    },
  };
}