import Joi from 'joi';
import { CODE_LENGTH } from '../../constants/auth/verification-code.js';
import { phoneField, universityEmailField, usernameField } from '../users/user-fields.js';

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;
const CODE_PATTERN = new RegExp(`^\\d{${CODE_LENGTH}}$`);

// 72 is the most bcrypt uses from a password, so a longer one would not make it stronger.
export const passwordRule = () =>
  Joi.string().min(8).max(72).pattern(PASSWORD_PATTERN).required().messages({
    'string.pattern.base': 'Password must contain at least one letter and one digit',
  });

// strip: the confirmation is checked here and never reaches the services.
export const confirmPasswordRule = (passwordField) =>
  Joi.any()
    .valid(Joi.ref(passwordField))
    .required()
    .strip()
    .messages({ 'any.only': 'Passwords do not match' });

// Format only. The university domain rule applies at signup and profile update, the other flows
// just look the account up.
const emailField = () => Joi.string().trim().lowercase().email().required();

const codeField = () =>
  Joi.string()
    .trim()
    .pattern(CODE_PATTERN)
    .required()
    .messages({
      'string.pattern.base': `Code must be ${CODE_LENGTH} digits`,
    });

export function createRegisterSchema({ allowedEmailDomains }) {
  return Joi.object({
    username: usernameField().required(),
    email: universityEmailField({ allowedEmailDomains }).required(),
    phone: phoneField().optional(),

    password: passwordRule(),
    confirmPassword: confirmPasswordRule('password'),
  });
}

export const verifyEmailSchema = Joi.object({
  email: emailField(),
  code: codeField(),
});

export const resendVerificationSchema = Joi.object({
  email: emailField(),
});

// No strength rule here, only the length cap: the strength rule applies when a password is set,
// so tightening it later never blocks existing accounts from logging in.
export const loginSchema = Joi.object({
  email: emailField(),
  password: Joi.string().max(72).required(),
});

export const forgotPasswordSchema = Joi.object({
  email: emailField(),
});

export const resetPasswordSchema = Joi.object({
  email: emailField(),
  code: codeField(),
  newPassword: passwordRule(),
  confirmPassword: confirmPasswordRule('newPassword'),
});
