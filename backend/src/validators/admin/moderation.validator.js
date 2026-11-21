import Joi from 'joi';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export const declarationIdParamsSchema = Joi.object({
  id: Joi.string().pattern(OBJECT_ID_PATTERN).required().messages({
    'string.pattern.base': 'id must be a valid declaration id',
    'any.required': 'id is required',
  }),
});

export const moderationBodySchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required(),
});
