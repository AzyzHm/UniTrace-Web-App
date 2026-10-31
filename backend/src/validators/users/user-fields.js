import Joi from 'joi';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;
const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
const emailFormat = Joi.string().email();

// Compared after the last "@" and in lowercase, so the case of the typed email does not matter.
export function isAllowedEmailDomain(email, allowedDomains) {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return allowedDomains.includes(domain);
}

export const usernameField = () =>
  Joi.string().trim().min(3).max(30).pattern(USERNAME_PATTERN).messages({
    'string.pattern.base': 'Username can only contain letters, digits, "_" and "."',
  });

export const phoneField = () =>
  Joi.string().trim().pattern(PHONE_PATTERN).messages({
    'string.pattern.base': 'Phone must be 8 to 15 digits, optionally starting with "+"',
  });

export const universityEmailField = ({ allowedEmailDomains }) =>
  Joi.string()
    .trim()
    .lowercase()
    .email()
    .custom((value, helpers) => {
      // All errors are collected, so this rule also runs after a bad format. Skipping it keeps a
      // malformed email from getting a misleading domain error on top of the format error.
      if (emailFormat.validate(value).error) return value;

      return isAllowedEmailDomain(value, allowedEmailDomains)
        ? value
        : helpers.error('domain.notAllowed');
    })
    .messages({ 'domain.notAllowed': 'Please use your university email address' });
