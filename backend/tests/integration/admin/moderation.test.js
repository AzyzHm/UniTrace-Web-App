import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS } from '../../../src/constants/common/events.js';
import { AuditLog } from '../../../src/models/admin/audit-log.model.js';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { createEventBus } from '../../../src/events/common/event-bus.js';
import { createAuditLogRepository } from '../../../src/repositories/admin/audit-log.repository.js';
import { createDeclarationRepository } from '../../../src/repositories/declarations/declaration.repository.js';
import { createUserRepository } from '../../../src/repositories/users/user.repository.js';
import { createAuditService } from '../../../src/services/admin/audit.service.js';
import { createModerationService } from '../../../src/services/admin/moderation.service.js';
import { createDeclarationService } from '../../../src/services/declarations/declaration.service.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

describe('declaration moderation (real database)', () => {
  let moderation;
  let eventBus;
  let owner;
  let admin;
  let events;

  beforeAll(async () => {
    await connectTestDb();
    await Promise.all([User.init(), Declaration.init(), AuditLog.init()]);
  });

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await clearTestDb();
    eventBus = createEventBus();
    const declarationRepository = createDeclarationRepository();
    const declarationService = createDeclarationService({
      declarationRepository,
      userRepository: createUserRepository(),
      eventBus,
    });
    const auditService = createAuditService({ auditLogRepository: createAuditLogRepository() });
    moderation = createModerationService({
      declarationService,
      declarationRepository,
      auditService,
    });

    owner = await User.create({
      username: 'sara.k',
      email: 'sara.k@isamm.uma.tn',
      password: 'hash',
      isEmailVerified: true,
    });
    admin = await User.create({
      username: 'admin',
      email: 'admin@isamm.uma.tn',
      password: 'hash',
      isEmailVerified: true,
      role: 'admin',
    });

    events = [];
    eventBus.on(EVENTS.DECLARATION_STATUS_CHANGED, (payload) => events.push(payload));
  });

  const declare = (overrides = {}) =>
    Declaration.create({
      title: 'Black backpack',
      type: 'lost',
      description: 'Black Nike backpack with a red keychain.',
      date: new Date('2026-10-12T00:00:00Z'),
      location: 'Main library, 2nd floor',
      category: 'wallet_bag',
      attributes: { brand: 'Nike' },
      privateInfo: 'Physics notebook inside',
      owner: owner._id,
      ...overrides,
    });

  const reload = (id) => Declaration.findById(id).select('+privateInfo').lean();
  const linesOf = (id) => AuditLog.find({ targetId: id }).sort({ _id: 1 }).lean();

  it('hides a declaration and writes an audit line with the reason', async () => {
    const stored = await declare();

    await moderation.hide(admin, stored._id, { reason: 'Looks like a fake listing' });

    const after = await reload(stored._id);
    expect(after.status).toBe('hidden');
    expect(after.statusBeforeHidden).toBe('pending');
    const lines = await linesOf(stored._id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      action: 'declaration.hidden',
      reason: 'Looks like a fake listing',
    });
  });

  it('restores a hidden declaration to its previous status', async () => {
    const stored = await declare();
    await moderation.hide(admin, stored._id, { reason: 'Checking it' });

    await moderation.restore(admin, stored._id, { reason: 'Checked, it is fine' });

    const after = await reload(stored._id);
    expect(after.status).toBe('pending');
    expect(after.statusBeforeHidden).toBeNull();
    expect((await linesOf(stored._id)).map((l) => l.action)).toEqual([
      'declaration.hidden',
      'declaration.restored',
    ]);
  });

  it('restores to matched when the declaration was matched before hiding', async () => {
    const stored = await declare({ status: 'matched' });
    await moderation.hide(admin, stored._id, { reason: 'Checking it' });

    await moderation.restore(admin, stored._id, { reason: 'Checked, it is fine' });

    expect((await reload(stored._id)).status).toBe('matched');
  });

  it('deletes a declaration, clears its private info and writes an audit line', async () => {
    const stored = await declare();

    await moderation.delete(admin, stored._id, { reason: 'Offensive content' });

    const after = await reload(stored._id);
    expect(after.status).toBe('deleted');
    expect(after.deletedAt).toBeInstanceOf(Date);
    expect(after.privateInfo).toBeNull();
    expect((await linesOf(stored._id))[0].action).toBe('declaration.deleted');
  });

  it('emits declaration.statusChanged carrying the reason', async () => {
    const stored = await declare();

    await moderation.hide(admin, stored._id, { reason: 'Looks like a fake listing' });

    expect(events[0]).toMatchObject({
      from: 'pending',
      to: 'hidden',
      reason: 'Looks like a fake listing',
    });
  });

  it('refuses a missing reason and changes nothing', async () => {
    const stored = await declare();

    await expect(moderation.hide(admin, stored._id, {})).rejects.toMatchObject({ statusCode: 400 });

    expect((await reload(stored._id)).status).toBe('pending');
    expect(await linesOf(stored._id)).toHaveLength(0);
  });

  it('refuses to hide a declaration twice, with a 409', async () => {
    const stored = await declare();
    await moderation.hide(admin, stored._id, { reason: 'First time' });

    await expect(moderation.hide(admin, stored._id, { reason: 'Again' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('refuses to restore a declaration that is not hidden, with a 409', async () => {
    const stored = await declare();

    await expect(
      moderation.restore(admin, stored._id, { reason: 'Reviewed' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('answers 404 for an unknown declaration and writes no audit line', async () => {
    const unknown = new mongoose.Types.ObjectId();

    await expect(moderation.hide(admin, unknown, { reason: 'Spam' })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await linesOf(unknown)).toHaveLength(0);
  });
});
