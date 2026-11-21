import Joi from 'joi';

export const notificationIdParamsSchema = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

export const listNotificationsQuerySchema = Joi.object({
  unreadOnly: Joi.boolean().default(false),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});
