import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from '../../../src/constants/common/events.js';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { RefreshToken } from '../../../src/models/auth/refresh-token.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { VerificationCode } from '../../../src/models/auth/verification-code.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import { makePng } from '../../helpers/pictures.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/users/me';
const PASSWORD = 'Secret123';

describe('DELETE /api/v1/users/me, effect on declarations', () => {
  let ctx;
  let sara;
  let omar;
  let token;
  let onStatusChanged;
  let off;

  const declare = (owner, overrides = {}) =>
    ctx.declarationRepository.create({
      title: 'Black backpack',
      type: 'lost',
      description: 'Black Nike backpack with a red keychain.',
      date: new Date('2026-10-12T00:00:00Z'),
      location: 'Main library, 2nd floor',
      owner: owner._id,
      category: 'wallet_bag',
      privateInfo: 'name on page 1',
      ...overrides,
    });

  const remove = () =>
    request(ctx.app)
      .delete(URL)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD });

  const stored = (declaration) => Declaration.findById(declaration._id).select('+privateInfo');

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await RefreshToken.init();
    await VerificationCode.init();
    await Declaration.init();
    ctx = buildTestApp();
  });

  afterAll(async () => {
    rmSync(ctx.uploadDir, { recursive: true, force: true });
    await disconnectTestDb();
  });
  afterEach(() => off());

  beforeEach(async () => {
    await clearTestDb();
    onStatusChanged = vi.fn();
    off = ctx.eventBus.on(EVENTS.DECLARATION_STATUS_CHANGED, onStatusChanged);
    const password = await ctx.passwordHasher.hash(PASSWORD);
    sara = await User.create({
      username: 'sara.k',
      email: 'sara@isamm.uma.tn',
      password,
      isEmailVerified: true,
    });
    omar = await User.create({
      username: 'omar.b',
      email: 'omar@isamm.uma.tn',
      password,
      isEmailVerified: true,
    });
    token = ctx.tokenService.signAccessToken(sara);
  });

  it('deletes the pending and expired declarations of the deleted user', async () => {
    const pending = await declare(sara);
    const expired = await declare(sara, { status: 'expired' });

    expect((await remove()).status).toBe(204);

    for (const declaration of [pending, expired]) {
      const after = await stored(declaration);
      expect(after.status).toBe('deleted');
      expect(after.deletedAt).toBeInstanceOf(Date);
    }
  });

  it('keeps matched, resolved and hidden declarations with their status', async () => {
    const kept = await Promise.all(
      ['matched', 'resolved', 'hidden'].map((status) => declare(sara, { status })),
    );

    await remove();

    for (const declaration of kept) {
      expect((await stored(declaration)).status).toBe(declaration.status);
    }
  });

  it('erases the private info of every declaration of the deleted user', async () => {
    const declarations = await Promise.all(
      ['pending', 'matched', 'resolved'].map((status) => declare(sara, { status })),
    );

    await remove();

    for (const declaration of declarations) {
      expect((await stored(declaration)).privateInfo).toBeNull();
    }
  });

  it('leaves the declarations of other users untouched', async () => {
    const theirs = await declare(omar);

    await remove();

    const after = await stored(theirs);
    expect(after.status).toBe('pending');
    expect(after.privateInfo).toBe('name on page 1');
  });

  it('announces a statusChanged event for each declaration it deleted', async () => {
    const pending = await declare(sara);
    await declare(sara, { status: 'resolved' });

    await remove();

    expect(onStatusChanged).toHaveBeenCalledTimes(1);
    expect(onStatusChanged).toHaveBeenCalledWith({
      declarationId: String(pending._id),
      ownerId: String(sara._id),
      from: 'pending',
      to: 'deleted',
      actor: 'system',
      reason: 'owner_deleted',
    });
  });

  it('still answers 204 for a user with no declaration', async () => {
    const res = await remove();

    expect(res.status).toBe(204);
    expect(onStatusChanged).not.toHaveBeenCalled();
  });

  describe('pictures', () => {
    const pictureName = (digit) => `${String(digit).repeat(32)}.png`;
    const fileOf = (name) => path.join(ctx.uploadDir, name);

    const withPicture = (owner, name, overrides = {}) => {
      writeFileSync(fileOf(name), makePng());
      return declare(owner, { picture: name, ...overrides });
    };

    it('removes the picture files of every declaration of the deleted user, kept ones included', async () => {
      const statuses = ['pending', 'expired', 'matched', 'resolved', 'hidden'];
      const declarations = await Promise.all(
        statuses.map((status, i) => withPicture(sara, pictureName(i), { status })),
      );

      expect((await remove()).status).toBe(204);

      for (const declaration of declarations) {
        expect(existsSync(fileOf(declaration.picture))).toBe(false);
        expect((await stored(declaration)).picture).toBeNull();
      }
    });

    it('leaves the pictures of other users alone', async () => {
      const theirs = await withPicture(omar, pictureName(9));

      await remove();

      expect(existsSync(fileOf(pictureName(9)))).toBe(true);
      expect((await stored(theirs)).picture).toBe(pictureName(9));
    });

    it('still answers 204 when a picture file is already gone', async () => {
      const declaration = await declare(sara, { picture: pictureName(7) });

      expect((await remove()).status).toBe(204);

      expect((await stored(declaration)).picture).toBeNull();
    });
  });
});
