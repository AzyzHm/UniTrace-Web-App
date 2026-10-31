import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createErrorHandler } from '../../../src/middlewares/common/error-handler.js';
import {
  createUploadPicture,
  parseMultipartAttributes,
  requirePicture,
} from '../../../src/middlewares/declarations/upload-picture.js';
import {
  makeJpeg,
  makeOversizedPng,
  makePng,
  makeScript,
  makeWebp,
} from '../../helpers/pictures.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  const upload = createUploadPicture();

  app.post('/optional', upload, parseMultipartAttributes, (req, res) => {
    res.json({
      body: { ...req.body },
      picture: req.picture
        ? { mime: req.picture.mime, ext: req.picture.ext, size: req.picture.buffer.length }
        : null,
      hasFile: Boolean(req.file),
    });
  });

  app.put('/required', upload, requirePicture, (req, res) => {
    res.json({ mime: req.picture.mime });
  });

  app.use(createErrorHandler({ logger: { error() {} } }));
  return app;
}

const app = buildApp();

describe('upload picture middleware', () => {
  it('lets a JSON request through with no picture', async () => {
    const res = await request(app).post('/optional').send({ title: 'Keys' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ body: { title: 'Keys' }, picture: null, hasFile: false });
  });

  it('lets a multipart request without a file through', async () => {
    const res = await request(app).post('/optional').field('title', 'Keys');

    expect(res.status).toBe(200);
    expect(res.body.picture).toBeNull();
    expect(res.body.body).toEqual({ title: 'Keys' });
  });

  it.each([
    ['jpeg', makeJpeg(), 'image/jpeg', 'jpg'],
    ['png', makePng(), 'image/png', 'png'],
    ['webp', makeWebp(), 'image/webp', 'webp'],
  ])('reads a %s and the text fields next to it', async (_n, buffer, mime, ext) => {
    const res = await request(app)
      .post('/optional')
      .field('title', 'Keys')
      .attach('picture', buffer, { filename: 'whatever.bin', contentType: 'application/x-foo' });

    expect(res.status).toBe(200);
    expect(res.body.picture).toEqual({ mime, ext, size: buffer.length });
    expect(res.body.body).toEqual({ title: 'Keys' });
    expect(res.body.hasFile).toBe(false);
  });

  it('decides the type by the bytes, not by the name or the declared type', async () => {
    const res = await request(app)
      .post('/optional')
      .attach('picture', makeScript(), { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'picture', message: 'Picture must be a jpeg, png or webp image' }],
    });
  });

  it('refuses an empty file', async () => {
    const res = await request(app)
      .post('/optional')
      .attach('picture', Buffer.alloc(0), { filename: 'a.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 413 FILE_TOO_LARGE above 5 MB', async () => {
    const res = await request(app)
      .post('/optional')
      .attach('picture', makeOversizedPng(), { filename: 'a.png', contentType: 'image/png' });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('accepts a file of exactly 5 MB', async () => {
    const res = await request(app)
      .post('/optional')
      .attach('picture', makePng(5 * 1024 * 1024), { filename: 'a.png' });

    expect(res.status).toBe(200);
    expect(res.body.picture.size).toBe(5 * 1024 * 1024);
  });

  it('refuses a file in another field, and says which', async () => {
    const res = await request(app)
      .post('/optional')
      .attach('avatar', makePng(), { filename: 'a.png' });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('avatar');
  });

  it('refuses two pictures', async () => {
    const res = await request(app)
      .post('/optional')
      .attach('picture', makePng(), { filename: 'a.png' })
      .attach('picture', makePng(), { filename: 'b.png' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 400, not 500, for a broken multipart body', async () => {
    const res = await request(app)
      .post('/optional')
      .set('Content-Type', 'multipart/form-data; boundary=xyz')
      .send('--xyz\r\nContent-Disposition: form-data; name="title"\r\n\r\nno end');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  describe('requirePicture', () => {
    it('answers 400 when no picture came', async () => {
      const res = await request(app).put('/required').field('x', 'y');

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'picture', message: 'A picture is required' },
      ]);
    });

    it('answers 400 for a JSON request', async () => {
      const res = await request(app).put('/required').send({ picture: 'x' });

      expect(res.status).toBe(400);
    });

    it('lets a valid picture through', async () => {
      const res = await request(app).put('/required').attach('picture', makeWebp(), 'a.webp');

      expect(res.status).toBe(200);
      expect(res.body.mime).toBe('image/webp');
    });
  });

  describe('parseMultipartAttributes', () => {
    it('turns a JSON string into an object', async () => {
      const res = await request(app)
        .post('/optional')
        .field('attributes', '{"brand":"Nike","color":"black"}');

      expect(res.body.body.attributes).toEqual({ brand: 'Nike', color: 'black' });
    });

    it('keeps the bracket form, which is already an object', async () => {
      const res = await request(app).post('/optional').field('attributes[brand]', 'Nike');

      expect(res.body.body.attributes).toEqual({ brand: 'Nike' });
    });

    it('answers 400 for a string that is not JSON', async () => {
      const res = await request(app).post('/optional').field('attributes', 'brand=Nike');

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'attributes', message: 'Attributes must be a valid JSON object' },
      ]);
    });

    it('leaves a JSON request alone, so Joi gives its usual message later', async () => {
      const res = await request(app).post('/optional').send({ attributes: 'brand=Nike' });

      expect(res.status).toBe(200);
      expect(res.body.body.attributes).toBe('brand=Nike');
    });
  });
});
