import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
import { EVENTS } from '../../../src/constants/common/events.js';
import { createContainer } from '../../../src/container/index.js';

const config = {
  jwt: { accessSecret: 'j'.repeat(32), accessExpires: '15m' },
  codeHashSecret: 'a'.repeat(32),
  uploadDir: 'uploads-not-used-in-this-test',
};

const emailService = {
  sendVerificationCode: vi.fn(),
  sendPasswordResetCode: vi.fn(),
};

describe('createContainer', () => {
  it('builds every service the routes use, by name', () => {
    const container = createContainer({ config, overrides: { emailService } });

    expect(Object.keys(container.services).sort()).toEqual([
      'accountDeletionService',
      'authService',
      'declarationService',
      'passwordChangeService',
      'passwordResetService',
      'profileService',
      'sessionService',
    ]);
    expect(typeof container.requireAuth).toBe('function');
  });

  it('mounts the routes of every domain when its services are given to the app', async () => {
    const container = createContainer({ config, overrides: { emailService } });
    const app = createApp({ ...container.services, requireAuth: container.requireAuth });

    expect((await request(app).get('/api/v1/users/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/declarations/mine')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(400);
  });

  it('uses the overrides it is given instead of building the part', () => {
    const pictureStorage = { remove: vi.fn() };
    const container = createContainer({ config, overrides: { emailService, pictureStorage } });

    expect(container.emailService).toBe(emailService);
    expect(container.pictureStorage).toBe(pictureStorage);
  });

  it('logs the codes instead of emailing them when AgentMail is not configured', () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

    createContainer({ config, logger });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('AgentMail'));
  });

  it('removes the picture files of a user when the user is deleted', async () => {
    const pictureStorage = { remove: vi.fn().mockResolvedValue(undefined) };
    const declarationRepository = {
      clearPrivateInfoByOwner: vi.fn().mockResolvedValue(0),
      softDeleteByOwner: vi.fn().mockResolvedValue([]),
      clearPicturesByOwner: vi.fn().mockResolvedValue(['aaa.png', 'bbb.webp']),
    };
    const container = createContainer({
      config,
      overrides: { emailService, pictureStorage, declarationRepository },
    });

    await container.eventBus.emit(EVENTS.USER_DELETED, {
      userId: 'u1',
      deletedAt: new Date(),
    });

    expect(declarationRepository.clearPicturesByOwner).toHaveBeenCalledWith('u1');
    expect(pictureStorage.remove).toHaveBeenCalledTimes(2);
    expect(pictureStorage.remove).toHaveBeenCalledWith('aaa.png');
    expect(pictureStorage.remove).toHaveBeenCalledWith('bbb.webp');
  });
});
