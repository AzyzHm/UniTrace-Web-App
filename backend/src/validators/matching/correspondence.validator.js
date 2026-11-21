import Joi from 'joi';
import { CORRESPONDENCE_STATUS_VALUES } from '../../constants/matching/correspondence.js';

const objectId = Joi.string().hex().length(24).required();

export const correspondenceIdParamsSchema = Joi.object({ id: objectId });
export const correspondenceDeclarationParamsSchema = Joi.object({ declarationId: objectId });

// unknown(false): a client cannot slip a score or a status into the body.
export const reactionBodySchema = Joi.object({
  comment: Joi.string().trim().max(500).allow(''),
}).unknown(false);

export const listCorrespondencesQuerySchema = Joi.object({
  status: Joi.string().valid(...CORRESPONDENCE_STATUS_VALUES),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
});
