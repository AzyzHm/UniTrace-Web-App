import { CONFIDENCE } from '../../constants/matching/correspondence.js';
import { MATCHING_CONFIG } from '../../constants/matching/matching-config.js';
import { dateScore } from './signals.js';

// Vectors are L2-normalized, so cosine similarity is the dot product.
export function cosine(a, b) {
  if (!a?.length || a.length !== b?.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

const percent = (value) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);
const round3 = (value) => (value === null ? null : Number(value.toFixed(3)));

// Floating point errors can push a perfect similarity to 1.0000003, which the Mongoose schema
// (max: 1) refuses. Every score is kept between 0 and 1.
const clamp01 = (value) => Math.min(1, Math.max(0, value));

const similarity = (a, b) => (a?.length && b?.length ? clamp01(cosine(a, b)) : null);

// lost and found are { declaration, textVector, locationVector, imageVector }.
// The logger is optional, so existing unit tests keep working.
export function calculateScore(lost, found, config = MATCHING_CONFIG, logger = null) {
  const parts = {
    description: clamp01(cosine(lost.textVector, found.textVector)),
    location: similarity(lost.locationVector, found.locationVector),
    date: clamp01(dateScore(lost.declaration.date, found.declaration.date, config.DATE_DECAY_DAYS)),
    image: similarity(lost.imageVector, found.imageVector),
  };

  // A missing signal is skipped and the remaining weights are renormalized.
  let weightSum = 0;
  let total = 0;
  const signals = {};
  for (const [name, value] of Object.entries(parts)) {
    const weight = config.WEIGHTS[name];
    if (value === null) {
      signals[name] = { value: null, weight, used: false };
      continue;
    }
    weightSum += weight;
    total += weight * value;
    signals[name] = {
      value: round3(value),
      weight,
      contribution: round3(weight * value),
      used: true,
    };
  }
  const globalScore = clamp01(total / weightSum);

  const confidence =
    globalScore >= config.HIGH_CONFIDENCE
      ? CONFIDENCE.HIGH
      : globalScore >= config.MEDIUM_CONFIDENCE
        ? CONFIDENCE.MEDIUM
        : CONFIDENCE.LOW;

  logger?.info(
    {
      lost: String(lost.declaration._id),
      found: String(found.declaration._id),
      signals,
      weightSum: round3(weightSum),
      rawTotal: round3(total),
      globalScore: round3(globalScore),
      confidence,
      thresholds: {
        minDescription: config.MIN_DESCRIPTION_SCORE,
        minGlobal: config.MIN_GLOBAL_SCORE,
        medium: config.MEDIUM_CONFIDENCE,
        high: config.HIGH_CONFIDENCE,
      },
      passesDescription: parts.description >= config.MIN_DESCRIPTION_SCORE,
      passesGlobal: globalScore >= config.MIN_GLOBAL_SCORE,
    },
    'Match score detail',
  );

  return {
    descriptionScore: parts.description,
    locationScore: parts.location,
    dateScore: parts.date,
    imageScore: parts.image,
    globalScore,
    confidence,
    explanation:
      `Description ${percent(parts.description)}, location ${percent(parts.location)}, ` +
      `date ${percent(parts.date)}, picture ${percent(parts.image)}`,
  };
}

export function passesThreshold(score, config = MATCHING_CONFIG) {
  return (
    score.descriptionScore >= config.MIN_DESCRIPTION_SCORE &&
    score.globalScore >= config.MIN_GLOBAL_SCORE
  );
}
