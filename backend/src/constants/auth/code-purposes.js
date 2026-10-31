// A code is stored and checked per purpose, so a code issued for one flow cannot be used in the
// other.
export const CODE_PURPOSES = Object.freeze({
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET: 'password_reset',
});

export const CODE_PURPOSE_VALUES = Object.freeze(Object.values(CODE_PURPOSES));
