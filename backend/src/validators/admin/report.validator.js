import Joi from 'joi';
import { REPORT_REASON_VALUES } from '../../constants/admin/report-reasons.js';
import { REPORT_STATUSES } from '../../constants/admin/report-status.js';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const objectId = (label) =>
  Joi.string()
    .pattern(OBJECT_ID_PATTERN)
    .required()
    .messages({
      'string.pattern.base': `${label} must be a valid id`,
      'any.required': `${label} is required`,
    });

export const createReportBodySchema = Joi.object({
  declarationId: objectId('declarationId'),
  reason: Joi.string()
    .valid(...REPORT_REASON_VALUES)
    .required(),
  comment: Joi.string().trim().max(500).allow(null).optional(),
});

export const listReportsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

export const reportIdParamsSchema = Joi.object({
  id: objectId('id'),
});

export const treatReportBodySchema = Joi.object({
  status: Joi.string().valid(REPORT_STATUSES.TREATED, REPORT_STATUSES.DISMISSED).required(),
  resolution: Joi.string().trim().min(3).max(500).optional(),
});
