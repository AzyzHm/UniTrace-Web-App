import { existsSync, readdirSync, rmSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Declaration } from '../../../src/models/declarations/declaration.model.js';
import { User } from '../../../src/models/users/user.model.js';
import { buildTestApp } from '../../helpers/build-test-app.js';
import {
  makeJpeg,
  makeOversizedPng,
  makePng,
  makeScript,
  makeWebp,
} from '../../helpers/pictures.js';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../../helpers/test-db.js';

const URL = '/api/v1/declarations';
const PASSWORD = 'Secret123';

describe('declaration pictures', () => {
  let ctx;
  let sara;
  let omar;
  let admin;
  let saraToken;
  let omarToken;
  let adminToken;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const filesOnDisk = () => readdirSync(ctx.uploadDir);

  const create = (token, { picture, fields = {} } = {}) => {
    const fieldsToSend = {
      title: 'Black backpack',
      type: 'lost',
      description: 'Black Nike backpack with a red keychain.',
      date: '2026-10-12',
      location: 'Main library',
      category: 'wallet_bag',
      ...fields,
    };
    let req = request(ctx.app).post(URL).set(auth(token));
    for (const [name, value] of Object.entries(fieldsToSend)) req = req.field(name, value);
    if (picture) req = req.attach('picture', picture.buffer, picture.options);
    return req;
  };

  const png = (name = 'photo.png') => ({
    buffer: makePng(),
    options: { filename: name, contentType: 'image/png' },
  });

  const put = (id, token, buffer = makeJpeg(), name = 'new.jpg') =>
    request(ctx.app).put(`${URL}/${id}/picture`).set(auth(token)).attach('picture', buffer, name);

  const declare = (owner, overrides = {}) =>
    Declaration.create({
      title: 'Black backpack',
      type: 'lost',
      description: 'Black Nike backpack with a red keychain.',
      date: new Date('2026-10-12T00:00:00Z'),
      location: 'Main library',
      category: 'wallet_bag',
      owner: owner._id,
      ...overrides,
    });

  const createUser = async (username, extra = {}) =>
    User.create({
      username,
      email: `${username}@isamm.uma.tn`,
      password: await ctx.passwordHasher.hash(PASSWORD),
      isEmailVerified: true,
      ...extra,
    });

  beforeAll(async () => {
    await connectTestDb();
    await User.init();
    await Declaration.init();
    ctx = buildTestApp();
  });

  afterAll(async () => {
    rmSync(ctx.uploadDir, { recursive: true, force: true });
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
    for (const file of filesOnDisk()) rmSync(`${ctx.uploadDir}/${file}`);
    sara = await createUser('sara.k');
    omar = await createUser('omar.b');
    admin = await createUser('admin', { role: 'admin' });
    saraToken = ctx.tokenService.signAccessToken(sara);
    omarToken = ctx.tokenService.signAccessToken(omar);
    adminToken = ctx.tokenService.signAccessToken(admin);
  });

  describe('POST /declarations with a picture', () => {
    it('creates the declaration, stores the file under a random name and returns its URL', async () => {
      const res = await create(saraToken, { picture: png() });

      expect(res.status).toBe(201);
      const { id, picture } = res.body.declaration;
      expect(picture).toBe(`${URL}/${id}/picture`);

      const stored = await Declaration.findById(id);
      expect(stored.picture).toMatch(/^[a-f0-9]{32}\.png$/);
      expect(filesOnDisk()).toEqual([stored.picture]);
      // The client's file name is never used.
      expect(JSON.stringify(res.body)).not.toContain('photo.png');
    });

    it.each([
      ['jpeg', makeJpeg(), 'jpg'],
      ['png', makePng(), 'png'],
      ['webp', makeWebp(), 'webp'],
    ])('accepts a %s and stores it with the right extension', async (_n, buffer, ext) => {
      const res = await create(saraToken, {
        picture: {
          buffer,
          options: { filename: 'x.dat', contentType: 'application/octet-stream' },
        },
      });

      expect(res.status).toBe(201);
      const stored = await Declaration.findById(res.body.declaration.id);
      expect(stored.picture.endsWith(`.${ext}`)).toBe(true);
    });

    it('reads attributes sent as a JSON string', async () => {
      const res = await create(saraToken, {
        picture: png(),
        fields: { attributes: '{"brand":"Nike","color":"black"}' },
      });

      expect(res.status).toBe(201);
      expect(res.body.declaration.attributes).toEqual({ brand: 'Nike', color: 'black' });
    });

    it('still takes a plain multipart request with no picture', async () => {
      const res = await create(saraToken);

      expect(res.status).toBe(201);
      expect(res.body.declaration.picture).toBeNull();
      expect(filesOnDisk()).toEqual([]);
    });

    it('answers 400 for a file that is not an image, whatever its name says, and saves nothing', async () => {
      const res = await create(saraToken, {
        picture: {
          buffer: makeScript(),
          options: { filename: 'photo.png', contentType: 'image/png' },
        },
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(filesOnDisk()).toEqual([]);
      expect(await Declaration.countDocuments()).toBe(0);
    });

    it('answers 413 FILE_TOO_LARGE above 5 MB and saves nothing', async () => {
      const res = await create(saraToken, {
        picture: { buffer: makeOversizedPng(), options: { filename: 'big.png' } },
      });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
      expect(filesOnDisk()).toEqual([]);
      expect(await Declaration.countDocuments()).toBe(0);
    });

    it('saves no file when the fields are invalid', async () => {
      const res = await create(saraToken, { picture: png(), fields: { title: 'x' } });

      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.field)).toContain('title');
      expect(filesOnDisk()).toEqual([]);
    });

    it('refuses a text field called picture, and saves nothing', async () => {
      const res = await create(saraToken, { fields: { picture: 'uploads/evil.png' } });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'picture', message: 'picture is not allowed' },
      ]);
      expect(await Declaration.countDocuments()).toBe(0);
    });

    it('refuses attributes that are not valid JSON', async () => {
      const res = await create(saraToken, {
        picture: png(),
        fields: { attributes: 'brand=Nike' },
      });

      expect(res.status).toBe(400);
      expect(filesOnDisk()).toEqual([]);
    });

    it('answers 401 without a token, before reading the file', async () => {
      const res = await request(ctx.app).post(URL).attach('picture', makePng(), 'a.png');

      expect(res.status).toBe(401);
      expect(filesOnDisk()).toEqual([]);
    });
  });

  describe('GET /declarations/:id/picture', () => {
    let id;

    beforeEach(async () => {
      id = (await create(saraToken, { picture: png() })).body.declaration.id;
    });

    const get = (token, target = id) => {
      const req = request(ctx.app).get(`${URL}/${target}/picture`);
      return token ? req.set(auth(token)) : req;
    };

    it('sends the file to the owner, with safe headers', async () => {
      const res = await get(saraToken);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-cache');
      expect(Buffer.compare(res.body, makePng())).toBe(0);
    });

    it('sends it to any other logged in user for an ordinary category', async () => {
      expect((await get(omarToken)).status).toBe(200);
      expect((await get(adminToken)).status).toBe(200);
    });

    it('answers 401 without a token', async () => {
      expect((await get(null)).status).toBe(401);
    });

    it('answers 400 for a malformed id', async () => {
      expect((await get(saraToken, 'not-an-id')).status).toBe(400);
    });

    it('answers 404 for an unknown id', async () => {
      expect((await get(saraToken, '507f1f77bcf86cd799439011')).status).toBe(404);
    });

    it('answers 404 for a declaration without picture', async () => {
      const bare = await declare(sara);

      const res = await get(saraToken, bare._id);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Picture not found');
    });

    it('answers 404 when the row has a picture but the file is gone', async () => {
      rmSync(`${ctx.uploadDir}/${filesOnDisk()[0]}`);

      const res = await get(saraToken);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('hides the picture of a student card from a stranger, but not from the owner or an admin', async () => {
      const card = (
        await create(saraToken, { picture: png(), fields: { category: 'student_card_id' } })
      ).body.declaration.id;

      expect((await get(omarToken, card)).status).toBe(404);
      expect((await get(saraToken, card)).status).toBe(200);
      expect((await get(adminToken, card)).status).toBe(200);
    });

    it('hides the picture of a hidden declaration from a stranger', async () => {
      await Declaration.updateOne({ _id: id }, { status: 'hidden', statusBeforeHidden: 'pending' });

      expect((await get(omarToken)).status).toBe(404);
      expect((await get(saraToken)).status).toBe(200);
      expect((await get(adminToken)).status).toBe(200);
    });

    it('is the URL the declaration gives, and a stranger gets no URL for a student card', async () => {
      const card = (
        await create(saraToken, { picture: png(), fields: { category: 'student_card_id' } })
      ).body.declaration.id;

      const own = await request(ctx.app).get(`${URL}/${id}`).set(auth(omarToken));
      const hidden = await request(ctx.app).get(`${URL}/${card}`).set(auth(omarToken));

      expect(own.body.declaration.picture).toBe(`${URL}/${id}/picture`);
      expect(hidden.body.declaration.picture).toBeNull();
    });
  });

  describe('PUT /declarations/:id/picture', () => {
    it('adds a picture to a declaration that has none', async () => {
      const stored = await declare(sara);

      const res = await put(stored._id, saraToken);

      expect(res.status).toBe(200);
      expect(res.body.declaration.picture).toBe(`${URL}/${stored._id}/picture`);
      expect(filesOnDisk()).toHaveLength(1);
      expect(filesOnDisk()[0]).toMatch(/\.jpg$/);
    });

    it('replaces the picture and deletes the old file', async () => {
      const created = await create(saraToken, { picture: png() });
      const id = created.body.declaration.id;
      const [oldFile] = filesOnDisk();

      const res = await put(id, saraToken);

      expect(res.status).toBe(200);
      expect(filesOnDisk()).toHaveLength(1);
      expect(filesOnDisk()[0]).not.toBe(oldFile);
      expect(existsSync(`${ctx.uploadDir}/${oldFile}`)).toBe(false);
      expect((await Declaration.findById(id)).picture).toBe(filesOnDisk()[0]);
    });

    it('announces the change', async () => {
      const stored = await declare(sara);
      const events = [];
      const off = ctx.eventBus.on('declaration.updated', (payload) => events.push(payload));

      await put(stored._id, saraToken);
      off();

      expect(events).toEqual([
        {
          declarationId: String(stored._id),
          ownerId: String(sara._id),
          changedFields: ['picture'],
        },
      ]);
    });

    it('answers 400 for a file that is not an image and keeps the old picture', async () => {
      const id = (await create(saraToken, { picture: png() })).body.declaration.id;
      const before = filesOnDisk();

      const res = await put(id, saraToken, makeScript(), 'x.png');

      expect(res.status).toBe(400);
      expect(filesOnDisk()).toEqual(before);
    });

    it('answers 413 above 5 MB and keeps the old picture', async () => {
      const id = (await create(saraToken, { picture: png() })).body.declaration.id;
      const before = filesOnDisk();

      const res = await put(id, saraToken, makeOversizedPng(), 'big.png');

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
      expect(filesOnDisk()).toEqual(before);
    });

    it('answers 400 when no picture is sent', async () => {
      const stored = await declare(sara);

      const res = await request(ctx.app)
        .put(`${URL}/${stored._id}/picture`)
        .set(auth(saraToken))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('picture');
    });

    it('answers 400 for a text field next to the picture', async () => {
      const stored = await declare(sara);

      const res = await request(ctx.app)
        .put(`${URL}/${stored._id}/picture`)
        .set(auth(saraToken))
        .field('status', 'resolved')
        .attach('picture', makePng(), 'a.png');

      expect(res.status).toBe(400);
      expect(filesOnDisk()).toEqual([]);
    });

    it('answers 403 to a stranger and writes nothing', async () => {
      const stored = await declare(sara);

      const res = await put(stored._id, omarToken);

      expect(res.status).toBe(403);
      expect(filesOnDisk()).toEqual([]);
    });

    it('answers 404 to a stranger for a hidden declaration', async () => {
      const stored = await declare(sara, { status: 'hidden', statusBeforeHidden: 'pending' });

      expect((await put(stored._id, omarToken)).status).toBe(404);
    });

    it.each(['matched', 'resolved', 'hidden'])(
      'answers 403 to the owner of a %s declaration',
      async (status) => {
        const stored = await declare(sara, {
          status,
          statusBeforeHidden: status === 'hidden' ? 'pending' : null,
        });

        const res = await put(stored._id, saraToken);

        expect(res.status).toBe(403);
        expect(filesOnDisk()).toEqual([]);
      },
    );

    it('lets the owner of an expired declaration do it', async () => {
      const stored = await declare(sara, { status: 'expired' });

      expect((await put(stored._id, saraToken)).status).toBe(200);
    });

    it('lets an admin do it on a resolved declaration', async () => {
      const stored = await declare(sara, { status: 'resolved' });

      expect((await put(stored._id, adminToken)).status).toBe(200);
    });

    it('answers 404 for a deleted declaration', async () => {
      const stored = await declare(sara, { status: 'deleted', deletedAt: new Date() });

      expect((await put(stored._id, saraToken)).status).toBe(404);
      expect(filesOnDisk()).toEqual([]);
    });

    it('answers 401 without a token', async () => {
      const stored = await declare(sara);

      const res = await request(ctx.app)
        .put(`${URL}/${stored._id}/picture`)
        .attach('picture', makePng(), 'a.png');

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /declarations/:id/picture', () => {
    const remove = (id, token) => request(ctx.app).delete(`${URL}/${id}/picture`).set(auth(token));

    it('clears the picture, deletes the file and returns the declaration', async () => {
      const id = (await create(saraToken, { picture: png() })).body.declaration.id;

      const res = await remove(id, saraToken);

      expect(res.status).toBe(200);
      expect(res.body.declaration.picture).toBeNull();
      expect(filesOnDisk()).toEqual([]);
      expect((await Declaration.findById(id)).picture).toBeNull();
    });

    it('is a no-op for a declaration without picture', async () => {
      const stored = await declare(sara);

      const res = await remove(stored._id, saraToken);

      expect(res.status).toBe(200);
      expect(res.body.declaration.picture).toBeNull();
    });

    it('answers 403 to a stranger and keeps the picture', async () => {
      const id = (await create(saraToken, { picture: png() })).body.declaration.id;

      const res = await remove(id, omarToken);

      expect(res.status).toBe(403);
      expect(filesOnDisk()).toHaveLength(1);
    });

    it('answers 403 to the owner of a matched declaration', async () => {
      const id = (await create(saraToken, { picture: png() })).body.declaration.id;
      await Declaration.updateOne({ _id: id }, { status: 'matched' });

      expect((await remove(id, saraToken)).status).toBe(403);
      expect(filesOnDisk()).toHaveLength(1);
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      expect((await remove('507f1f77bcf86cd799439011', saraToken)).status).toBe(404);
      expect((await remove('nope', saraToken)).status).toBe(400);
    });
  });

  describe('deleting the declaration', () => {
    it('deletes the picture file and clears the picture of the row', async () => {
      const id = (await create(saraToken, { picture: png() })).body.declaration.id;

      const res = await request(ctx.app).delete(`${URL}/${id}`).set(auth(saraToken));

      expect(res.status).toBe(204);
      expect(filesOnDisk()).toEqual([]);
      expect((await Declaration.findById(id)).picture).toBeNull();
    });

    it('keeps the picture when the declaration only changes status', async () => {
      const id = (await create(saraToken, { picture: png() })).body.declaration.id;

      const res = await request(ctx.app)
        .patch(`${URL}/${id}/status`)
        .set(auth(saraToken))
        .send({ status: 'resolved' });

      expect(res.status).toBe(200);
      expect(filesOnDisk()).toHaveLength(1);
    });
  });

  describe('PATCH /declarations/:id', () => {
    it('still refuses picture in the JSON body', async () => {
      const stored = await declare(sara);

      const res = await request(ctx.app)
        .patch(`${URL}/${stored._id}`)
        .set(auth(saraToken))
        .send({ picture: 'uploads/evil.png' });

      expect(res.status).toBe(400);
    });
  });
});
