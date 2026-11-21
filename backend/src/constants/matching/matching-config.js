// PROVISIONAL values: calibrate the thresholds from measured scores (benchmark section 9.1/9.3).
export const MATCHING_CONFIG = Object.freeze({
  TEXT_MODEL: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  IMAGE_MODEL: 'Xenova/clip-vit-base-patch16',

  // A missing signal (no picture) is skipped and the rest renormalized.
  WEIGHTS: Object.freeze({ description: 0.5, location: 0.2, date: 0.15, image: 0.15 }),

  MIN_DESCRIPTION_SCORE: 0.35, // never a match if the text is not similar, whatever place/date say
  MIN_GLOBAL_SCORE: 0.5,
  HIGH_CONFIDENCE: 0.75,
  MEDIUM_CONFIDENCE: 0.6,

  MAX_GAP_DAYS: 90, // case 5: a late find is still searched, its date score only decays
  DATE_DECAY_DAYS: 14,
  MAX_CANDIDATES: 200,
  MAX_MATCHES_PER_DECLARATION: 5, // case 2: only the best ones are proposed
  REOPEN_DELTA: 0.1, // case 3: a refused match reopens only if its score rose by 10 points
});
