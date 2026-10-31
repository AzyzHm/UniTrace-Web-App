import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import {
  toDeclarationSummary,
  toOwnerDeclarationResponse,
  toPublicDeclarationResponse,
} from '../../../src/presenters/declarations/declaration.presenter.js';

function build(overrides = {}) {
  return new Declaration({
    title: 'Black backpack',
    type: 'lost',
    description: 'Black Nike backpack with a red keychain.',
    date: new Date('2026-10-12T00:00:00Z'),
    location: 'Main library, 2nd floor',
    owner: new mongoose.Types.ObjectId(),
    category: 'wallet_bag',
    attributes: { brand: 'Nike', color: 'black' },
    privateInfo: 'Name on page 1',
    ...overrides,
  });
}

describe('owner declaration presenter', () => {
  it('returns exactly the owner view, and nothing else', () => {
    const response = toOwnerDeclarationResponse(build());

    expect(Object.keys(response).sort()).toEqual([
      'attributes',
      'category',
      'createdAt',
      'date',
      'description',
      'id',
      'location',
      'picture',
      'privateInfo',
      'status',
      'title',
      'type',
      'updatedAt',
    ]);
  });

  it('never exposes the owner id, the internal fields or Mongoose internals', () => {
    const response = toOwnerDeclarationResponse(
      build({ status: 'hidden', statusBeforeHidden: 'pending', deletedAt: new Date() }),
    );
    const text = JSON.stringify(response);

    expect(response).not.toHaveProperty('owner');
    expect(response).not.toHaveProperty('statusBeforeHidden');
    expect(response).not.toHaveProperty('deletedAt');
    expect(response).not.toHaveProperty('_id');
    expect(response).not.toHaveProperty('__v');
    expect(text).not.toContain('pending');
  });

  it('uses the string id', () => {
    const doc = build();

    expect(toOwnerDeclarationResponse(doc).id).toBe(String(doc._id));
  });

  it('turns the attributes Map into a plain object that serializes', () => {
    const response = toOwnerDeclarationResponse(build());

    expect(response.attributes).toEqual({ brand: 'Nike', color: 'black' });
    expect(JSON.parse(JSON.stringify(response)).attributes).toEqual({
      brand: 'Nike',
      color: 'black',
    });
  });

  it('answers an empty object when there are no attributes', () => {
    expect(toOwnerDeclarationResponse(build({ attributes: undefined })).attributes).toEqual({});
  });

  it('answers null, not undefined, for the optional fields that are empty', () => {
    const response = toOwnerDeclarationResponse(build({ privateInfo: undefined }));

    expect(response.privateInfo).toBeNull();
    expect(response.picture).toBeNull();
  });

  it('also works on a plain object, such as a lean query result', () => {
    const id = new mongoose.Types.ObjectId();

    const response = toOwnerDeclarationResponse({
      _id: id,
      title: 'Black backpack',
      type: 'lost',
      description: 'Black Nike backpack with a red keychain.',
      category: 'wallet_bag',
      attributes: { brand: 'Nike' },
      status: 'pending',
      date: new Date('2026-10-12T00:00:00Z'),
      location: 'Main library',
      owner: new mongoose.Types.ObjectId(),
    });

    expect(response.id).toBe(String(id));
    expect(response.attributes).toEqual({ brand: 'Nike' });
    expect(response.privateInfo).toBeNull();
    expect(response).not.toHaveProperty('owner');
  });
});

describe('public declaration presenter', () => {
  // Checks the full key list, not only the private keys: a field added to the model stays private
  // until it is added to the presenter on purpose.
  it('returns exactly the public split, and nothing else', () => {
    const response = toPublicDeclarationResponse(build());

    expect(Object.keys(response).sort()).toEqual([
      'attributes',
      'category',
      'createdAt',
      'date',
      'description',
      'id',
      'location',
      'picture',
      'status',
      'title',
      'type',
    ]);
  });

  it('never exposes the private info, the owner, the internals or the update date', () => {
    const response = toPublicDeclarationResponse(
      build({ statusBeforeHidden: 'matched', deletedAt: new Date() }),
    );
    const keys = Object.keys(response);

    for (const hidden of [
      'privateInfo',
      'owner',
      'statusBeforeHidden',
      'deletedAt',
      'updatedAt',
      '_id',
      '__v',
    ]) {
      expect(keys).not.toContain(hidden);
    }
    expect(JSON.stringify(response)).not.toContain('Name on page 1');
  });

  // The owner's identity is revealed only inside an accepted match.
  it('never leaks the owner id, even as text inside another field', () => {
    const doc = build();

    expect(JSON.stringify(toPublicDeclarationResponse(doc))).not.toContain(String(doc.owner));
  });

  it('keeps the description and the attributes, a stranger needs them to recognize the item', () => {
    const response = toPublicDeclarationResponse(build());

    expect(response.description).toBe('Black Nike backpack with a red keychain.');
    expect(response.attributes).toEqual({ brand: 'Nike', color: 'black' });
    expect(JSON.parse(JSON.stringify(response)).attributes).toEqual({
      brand: 'Nike',
      color: 'black',
    });
  });

  it('uses the string id', () => {
    const doc = build();

    expect(toPublicDeclarationResponse(doc).id).toBe(String(doc._id));
  });

  it('gives the URL of the picture of an ordinary category, never the file name', () => {
    const doc = build({ picture: 'uploads/9f3c1a.webp' });

    const response = toPublicDeclarationResponse(doc);

    expect(response.picture).toBe(`/api/v1/declarations/${doc.id}/picture`);
    expect(JSON.stringify(response)).not.toContain('9f3c1a');
  });

  it('hides the picture of a student card, even when one is stored', () => {
    const response = toPublicDeclarationResponse(
      build({ category: 'student_card_id', picture: 'uploads/card.webp' }),
    );

    expect(response.picture).toBeNull();
    expect(JSON.stringify(response)).not.toContain('card.webp');
  });

  it('answers null, not undefined, when there is no picture', () => {
    expect(toPublicDeclarationResponse(build()).picture).toBeNull();
  });

  it('does not crash on a category it does not know', () => {
    const _id = new mongoose.Types.ObjectId();

    const response = toPublicDeclarationResponse({
      _id,
      category: 'something_new',
      picture: 'uploads/x.webp',
    });

    expect(response.picture).toBe(`/api/v1/declarations/${_id}/picture`);
  });

  it('also works on a plain object, such as a lean query result', () => {
    const _id = new mongoose.Types.ObjectId();

    const response = toPublicDeclarationResponse({
      _id,
      title: 'Keys',
      type: 'found',
      description: 'A bunch of keys with a blue tag.',
      category: 'keys',
      status: 'pending',
      date: new Date('2026-10-12T00:00:00Z'),
      location: 'Hall',
      owner: new mongoose.Types.ObjectId(),
      privateInfo: 'should never show',
    });

    expect(response.id).toBe(String(_id));
    expect(response.attributes).toEqual({});
    expect(response).not.toHaveProperty('owner');
    expect(response).not.toHaveProperty('privateInfo');
  });
});

describe('picture URL', () => {
  it('is null without a picture and the same URL in every view with one', () => {
    const none = build();
    const doc = build({ picture: 'abc.png' });
    const url = `/api/v1/declarations/${doc.id}/picture`;

    expect(toOwnerDeclarationResponse(none).picture).toBeNull();
    expect(toOwnerDeclarationResponse(doc).picture).toBe(url);
    expect(toDeclarationSummary(doc).picture).toBe(url);
    expect(toPublicDeclarationResponse(doc).picture).toBe(url);
  });

  it('works on a lean row too', () => {
    const _id = new mongoose.Types.ObjectId();

    expect(toDeclarationSummary({ _id, picture: 'abc.png' }).picture).toBe(
      `/api/v1/declarations/${_id}/picture`,
    );
  });
});

describe('declaration summary presenter', () => {
  it('returns exactly the list row, and nothing else', () => {
    const response = toDeclarationSummary(build());

    expect(Object.keys(response).sort()).toEqual([
      'category',
      'createdAt',
      'date',
      'id',
      'location',
      'picture',
      'status',
      'title',
      'type',
      'updatedAt',
    ]);
  });

  it('leaves out the private info, the long fields and the internals', () => {
    const response = toDeclarationSummary(build({ statusBeforeHidden: 'matched' }));
    const keys = Object.keys(response);

    for (const hidden of [
      'privateInfo',
      'description',
      'attributes',
      'owner',
      'statusBeforeHidden',
      'deletedAt',
      '_id',
      '__v',
    ]) {
      expect(keys).not.toContain(hidden);
    }
    expect(JSON.stringify(response)).not.toContain('Name on page 1');
  });

  it('reads a lean row, where the id is an ObjectId called _id', () => {
    const _id = new mongoose.Types.ObjectId();

    const response = toDeclarationSummary({
      _id,
      title: 'Keys',
      type: 'found',
      category: 'keys',
      status: 'pending',
      date: new Date('2026-10-12T00:00:00Z'),
      location: 'Hall',
      owner: new mongoose.Types.ObjectId(),
      privateInfo: 'should never show',
    });

    expect(response.id).toBe(String(_id));
    expect(response.picture).toBeNull();
    expect(response).not.toHaveProperty('owner');
    expect(response).not.toHaveProperty('privateInfo');
  });
});
