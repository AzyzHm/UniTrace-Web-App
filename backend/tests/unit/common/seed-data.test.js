import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { CATEGORY_KEYS } from '../../../src/constants/declarations/categories.js';
import { DECLARATION_STATUS_VALUES } from '../../../src/constants/declarations/declaration-status.js';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { ADMIN_USERNAME, SEED_DECLARATIONS, SEED_USERS } from '../../../src/seed/seed-data.js';

const usernames = SEED_USERS.map((user) => user.username);

describe('seed data', () => {
  it('has exactly one admin, and it is the one the seed looks for', () => {
    const admins = SEED_USERS.filter((user) => user.role === 'admin');

    expect(admins.map((user) => user.username)).toEqual([ADMIN_USERNAME]);
  });

  it('uses usernames that follow the register rules', () => {
    for (const username of usernames) {
      expect(username).toMatch(/^[a-zA-Z0-9_.]{3,30}$/);
    }
    expect(new Set(usernames.map((u) => u.toLowerCase())).size).toBe(usernames.length);
  });

  it('has more than 20 declarations, each owned by a seeded user', () => {
    expect(SEED_DECLARATIONS.length).toBeGreaterThan(20);
    for (const declaration of SEED_DECLARATIONS) {
      expect(usernames).toContain(declaration.owner);
    }
  });

  it('only gives declarations to regular users, so the admin dashboard stays clean', () => {
    expect(SEED_DECLARATIONS.some((d) => d.owner === ADMIN_USERNAME)).toBe(false);
  });

  it('covers every category and both types', () => {
    const categories = new Set(SEED_DECLARATIONS.map((d) => d.category));
    const types = new Set(SEED_DECLARATIONS.map((d) => d.type));

    expect([...categories].sort()).toEqual([...CATEGORY_KEYS].sort());
    expect([...types].sort()).toEqual(['found', 'lost']);
  });

  it('covers every status except deleted', () => {
    const statuses = new Set(SEED_DECLARATIONS.map((d) => d.status ?? 'pending'));

    expect([...statuses].sort()).toEqual(
      DECLARATION_STATUS_VALUES.filter((s) => s !== 'deleted').sort(),
    );
  });

  it('gives every hidden declaration the status it will be restored to', () => {
    for (const d of SEED_DECLARATIONS.filter((x) => x.status === 'hidden')) {
      expect(d.statusBeforeHidden).toBeTruthy();
    }
  });

  it('only uses days in the past', () => {
    for (const { daysAgo } of SEED_DECLARATIONS) {
      expect(daysAgo).toBeGreaterThan(0);
    }
  });

  it('builds declarations the model accepts', async () => {
    for (const { daysAgo, ...fields } of SEED_DECLARATIONS) {
      const doc = new Declaration({
        ...fields,
        owner: new mongoose.Types.ObjectId(),
        date: new Date(Date.now() - daysAgo * 86_400_000),
      });

      await expect(doc.validate(), fields.title).resolves.toBeUndefined();
    }
  });
});
