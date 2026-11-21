import Joi from 'joi';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export const listUsersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

export const userIdParamsSchema = Joi.object({
  id: Joi.string().pattern(OBJECT_ID_PATTERN).required().messages({
    'string.pattern.base': 'id must be a valid user id',
    'any.required': 'id is required',
  }),
});

export const deleteUserBodySchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required(),
});
