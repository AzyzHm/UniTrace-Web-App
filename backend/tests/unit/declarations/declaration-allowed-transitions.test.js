import { describe, expect, it, vi } from 'vitest';
import { DECLARATION_STATUS_VALUES } from '../../../src/constants/declarations/declaration-status.js';
import { createDeclarationService } from '../../../src/services/declarations/declaration.service.js';

const ID = '507f1f77bcf86cd799439055';
const OWNER_ID = '507f1f77bcf86cd799439022';

const CALLERS = {
  owner: { _id: OWNER_ID, role: 'user' },
  admin: { _id: '507f1f77bcf86cd799439044', role: 'admin' },
  stranger: { _id: '507f1f77bcf86cd799439033', role: 'user' },
};

const HIDDEN_ORIGINS = [null, 'pending', 'matched', 'resolved'];

function storedDeclarations() {
  return DECLARATION_STATUS_VALUES.flatMap((status) =>
    status === 'hidden'
      ? HIDDEN_ORIGINS.map((origin) => ({ status, statusBeforeHidden: origin }))
      : [{ status, statusBeforeHidden: null }],
  );
}

function buildService(stored) {
  const found = { _id: ID, owner: OWNER_ID, ...stored };
  const declarationRepository = {
    findById: vi.fn().mockResolvedValue(found),
    findByIdWithPrivateInfo: vi.fn().mockResolvedValue(found),
    updateFields: vi.fn().mockResolvedValue({ _id: ID }),
  };
  const userRepository = { findById: vi.fn().mockResolvedValue({ _id: OWNER_ID }) };
  const eventBus = { emit: vi.fn().mockResolvedValue(undefined) };

  return createDeclarationService({ declarationRepository, userRepository, eventBus });
}

async function succeeds(stored, user, target) {
  try {
    await buildService(stored).changeStatus(user, ID, target);
    return true;
  } catch {
    return false;
  }
}

describe('allowedTransitions against changeStatus', () => {
  for (const stored of storedDeclarations()) {
    const label = stored.statusBeforeHidden
      ? `${stored.status} (was ${stored.statusBeforeHidden})`
      : stored.status;

    for (const [who, user] of Object.entries(CALLERS)) {
      it(`lists exactly the moves changeStatus accepts, ${who} on ${label}`, async () => {
        const listed = await buildService(stored)
          .getById(user, ID)
          .then((result) => result.allowedTransitions)
          .catch(() => []);

        const accepted = [];
        for (const target of DECLARATION_STATUS_VALUES) {
          if (await succeeds(stored, user, target)) accepted.push(target);
        }

        expect([...listed].sort()).toEqual([...accepted].sort());
      });
    }
  }
});
