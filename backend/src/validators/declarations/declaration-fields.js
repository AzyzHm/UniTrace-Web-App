import Joi from 'joi';
import { CATEGORY_KEYS } from '../../constants/declarations/categories.js';
import { DECLARATION_LIMITS as LIMITS } from '../../constants/declarations/declaration-limits.js';
import { DECLARATION_TYPE_VALUES } from '../../constants/declarations/declaration-types.js';

const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,29}$/;
const MAX_ATTRIBUTES = 10;

export const titleField = () => Joi.string().trim().min(LIMITS.TITLE_MIN).max(LIMITS.TITLE_MAX);

export const typeField = () => Joi.string().valid(...DECLARATION_TYPE_VALUES);

export const descriptionField = () =>
  Joi.string().trim().min(LIMITS.DESCRIPTION_MIN).max(LIMITS.DESCRIPTION_MAX);

export const locationField = () =>
  Joi.string().trim().min(LIMITS.LOCATION_MIN).max(LIMITS.LOCATION_MAX);

export const categoryField = () => Joi.string().valid(...CATEGORY_KEYS);

// Joi turns "2026-02-30" into March 2 instead of refusing it. The raw string is checked here to
// make sure the day really exists. Joi has already converted the value, so helpers.original is
// the only place that still holds what the client sent.
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function checkCalendarDay(value, helpers) {
  const match = DATE_PREFIX.exec(String(helpers.original));
  if (!match) return helpers.error('date.format');

  const [, year, month, day] = match.map(Number);
  const real = new Date(Date.UTC(year, month - 1, day));
  const isRealDay = real.getUTCMonth() === month - 1 && real.getUTCDate() === day;

  return isRealDay ? value : helpers.error('date.format');
}

// max('now'): an item cannot have been lost or found in the future.
export const dateField = () =>
  Joi.date().iso().custom(checkCalendarDay).max('now').messages({
    'date.format': 'Date must be a valid ISO date, for example 2026-10-12',
    'date.base': 'Date must be a valid ISO date, for example 2026-10-12',
    'date.max': 'Date cannot be in the future',
  });

// A flat map of short strings with a bounded size, so a client cannot store large or nested data.
export const attributesField = () =>
  Joi.object()
    .pattern(ATTRIBUTE_KEY_PATTERN, Joi.string().trim().max(LIMITS.ATTRIBUTE_VALUE_MAX))
    .max(MAX_ATTRIBUTES);

export const privateInfoField = () => Joi.string().trim().max(LIMITS.PRIVATE_INFO_MAX);
