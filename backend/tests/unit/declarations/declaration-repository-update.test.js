import { describe, expect, it, vi } from 'vitest';
import { createDeclarationRepository } from '../../../src/repositories/declarations/declaration.repository.js';

function setup(result = { _id: 'a' }) {
  const select = vi.fn().mockResolvedValue(result);
  const model = { findOneAndUpdate: vi.fn(() => ({ select })) };
  return { repository: createDeclarationRepository({ model }), model, select };
}

const ID = '507f1f77bcf86cd799439055';

describe('declaration repository, updateFields', () => {
  it('filters on the id AND on the status the caller decided on', async () => {
    const { repository, model } = setup();

    await repository.updateFields(ID, { title: 'Blue backpack' }, 'pending');

    expect(model.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: ID, status: 'pending' });
  });

  it('sets exactly the given fields, nothing else', async () => {
    const { repository, model } = setup();

    await repository.updateFields(ID, { title: 'Blue backpack', location: 'Cafeteria' }, 'pending');

    expect(model.findOneAndUpdate.mock.calls[0][1]).toEqual({
      $set: { title: 'Blue backpack', location: 'Cafeteria' },
    });
  });

  it('returns the document after the update and runs the model rules again', async () => {
    const { repository, model } = setup();

    await repository.updateFields(ID, { title: 'Blue backpack' }, 'pending');

    expect(model.findOneAndUpdate.mock.calls[0][2]).toEqual({
      returnDocument: 'after',
      runValidators: true,
    });
  });

  it('loads the private info, the caller is the owner or an admin', async () => {
    const { repository, select } = setup();

    await repository.updateFields(ID, { title: 'Blue backpack' }, 'pending');

    expect(select).toHaveBeenCalledWith('+privateInfo');
  });

  it('answers null when the filter matched nothing', async () => {
    const { repository } = setup(null);

    await expect(
      repository.updateFields(ID, { title: 'Blue backpack' }, 'pending'),
    ).resolves.toBeNull();
  });
});
