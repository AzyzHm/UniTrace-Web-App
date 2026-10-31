import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { createContainer } from '../../src/container/index.js';
import { createPasswordHasher } from '../../src/services/auth/password-hasher.js';

export const TEST_JWT_SECRET = 'j'.repeat(32);

export function buildTestApp() {
  // Controllable clock: tests move time with advance() instead of sleeping, so token expiry and
  // code cooldowns run instantly.
  let now = Date.now();
  const clock = () => new Date(now);

  // Fake email service: nothing is sent, and tests read the codes from the recorded calls.
  const emailService = {
    sendVerificationCode: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetCode: vi.fn().mockResolvedValue(undefined),
  };

  // A fresh temp folder per app, so picture tests never write inside the project.
  const uploadDir = mkdtempSync(path.join(tmpdir(), 'unitrace-pictures-'));

  const container = createContainer({
    config: {
      jwt: { accessSecret: TEST_JWT_SECRET, accessExpires: '15m' },
      codeHashSecret: 'a'.repeat(32),
      uploadDir,
    },
    clock,
    // Cost 4 instead of the production default of 12 keeps password hashing fast in tests.
    overrides: { emailService, passwordHasher: createPasswordHasher({ cost: 4 }) },
  });

  const app = createApp({
    ...container.services,
    requireAuth: container.requireAuth,
    // Register and profile-update validation only accept this email domain.
    allowedEmailDomains: ['isamm.uma.tn'],
  });

  return {
    app,
    eventBus: container.eventBus,
    declarationRepository: container.declarationRepository,
    uploadDir,
    emailService,
    passwordHasher: container.passwordHasher,
    tokenService: container.tokenService,
    advance: (ms) => {
      now += ms;
    },
  };
}
