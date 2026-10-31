// Six digits are easy to type but only one million possibilities, so the code lives a short
// time and the number of attempts is capped to make guessing impractical.
export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 10;
export const CODE_TTL_MS = CODE_TTL_MINUTES * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
// Stops the "resend" button from being used to flood someone's inbox.
export const CODE_RESEND_COOLDOWN_MS = 2 * 60_000;
