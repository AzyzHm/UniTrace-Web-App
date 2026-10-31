import Joi from 'joi';
import { confirmPasswordRule, passwordRule } from '../auth/auth.validator.js';
import { phoneField, universityEmailField, usernameField } from './user-fields.js';

export function createUpdateProfileSchema({ allowedEmailDomains }) {
  return Joi.object({
    username: usernameField(),
    email: universityEmailField({ allowedEmailDomains }),
    // null is allowed so a user can remove their phone number.
    phone: phoneField().allow(null),
  })
    .min(1)
    .messages({ 'object.min': 'Send at least one field to update' });
}

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().max(72).required(),
  newPassword: passwordRule()
    .invalid(Joi.ref('currentPassword'))
    .messages({ 'any.invalid': 'New password must be different from the current password' }),
  confirmPassword: confirmPasswordRule('newPassword'),
});

export const deleteAccountSchema = Joi.object({
  password: Joi.string().max(72).required(),
});
