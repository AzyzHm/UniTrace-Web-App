import Joi from 'joi';
import { PAGINATION } from '../../constants/common/pagination.js';
import { DECLARATION_STATUS_VALUES } from '../../constants/declarations/declaration-status.js';
import {
  attributesField,
  categoryField,
  dateField,
  descriptionField,
  locationField,
  privateInfoField,
  titleField,
  typeField,
} from './declaration-fields.js';

export const createDeclarationSchema = Joi.object({
  title: titleField().required(),
  type: typeField().required(),
  description: descriptionField().required(),
  date: dateField().required(),
  location: locationField().required(),
  category: categoryField().required(),
  attributes: attributesField(),
  privateInfo: privateInfoField(),
});

// Only the fields an owner may edit. type, privateInfo, status and picture are not listed, so
// sending one is rejected as an unknown field.
export const updateDeclarationSchema = Joi.object({
  title: titleField(),
  description: descriptionField(),
  date: dateField(),
  location: locationField(),
  category: categoryField(),
  attributes: attributesField(),
})
  .min(1)
  .messages({ 'object.min': 'At least one field to update is required' });

// The picture route takes the file only, so any text field next to it is rejected.
export const pictureBodySchema = Joi.object({});

// Checks only that the value is a known status. Whether the move is allowed is decided by the
// transition rules in the service.
export const changeDeclarationStatusSchema = Joi.object({
  status: Joi.string()
    .valid(...DECLARATION_STATUS_VALUES)
    .required(),
});

// A malformed id is a 400 here, before it can reach Mongoose and fail as a cast error.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export const declarationIdParamsSchema = Joi.object({
  id: Joi.string().pattern(OBJECT_ID_PATTERN).required().messages({
    'string.base': 'id must be a valid declaration id',
    'string.empty': 'id must be a valid declaration id',
    'string.pattern.base': 'id must be a valid declaration id',
    'any.required': 'id is required',
  }),
});

// Without a status filter the repository hides deleted declarations, but it would return them
// for status=deleted. Removing that value here keeps soft deleted declarations out of the list.
const LISTABLE_STATUS_VALUES = DECLARATION_STATUS_VALUES.filter((status) => status !== 'deleted');

export const listMyDeclarationsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: Joi.number().integer().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
  type: typeField(),
  status: Joi.string().valid(...LISTABLE_STATUS_VALUES),
});
