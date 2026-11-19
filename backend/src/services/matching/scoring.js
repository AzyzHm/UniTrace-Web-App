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
const similarity = (a, b) => (a?.length && b?.length ? Math.max(0, cosine(a, b)) : null);

// lost and found are { declaration, textVector, locationVector, imageVector }.
// Pure function: easy to unit test.
export function calculateScore(lost, found, config = MATCHING_CONFIG) {
  const parts = {
    description: Math.max(0, cosine(lost.textVector, found.textVector)),
    location: similarity(lost.locationVector, found.locationVector),
    date: dateScore(lost.declaration.date, found.declaration.date, config.DATE_DECAY_DAYS),
    image: similarity(lost.imageVector, found.imageVector),
  };

  // A missing signal is skipped and the remaining weights are renormalized.
  let weightSum = 0;
  let total = 0;
  for (const [name, value] of Object.entries(parts)) {
    if (value === null) continue;
    weightSum += config.WEIGHTS[name];
    total += config.WEIGHTS[name] * value;
  }
  const globalScore = total / weightSum;

  const confidence =
    globalScore >= config.HIGH_CONFIDENCE ? CONFIDENCE.HIGH
    : globalScore >= config.MEDIUM_CONFIDENCE ? CONFIDENCE.MEDIUM
    : CONFIDENCE.LOW;

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
  return score.descriptionScore >= config.MIN_DESCRIPTION_SCORE && score.globalScore >= config.MIN_GLOBAL_SCORE;
}