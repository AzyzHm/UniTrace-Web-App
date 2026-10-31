import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadEnv } from '../../../src/config/env.js';

const valid = { MONGODB_URI: 'mongodb://localhost:27017/test' };

describe('loadEnv', () => {
  it('applies defaults when optional values are missing', () => {
    const env = loadEnv(valid);
    expect(env.port).toBe(3000);
    expect(env.nodeEnv).toBe('development');
    expect(env.logLevel).toBe('info');
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnv({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects a missing MONGO_URI', () => {
    expect(() => loadEnv({})).toThrow(/MONGODB_URI/);
  });

  it('reports every problem at once', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/PORT[\s\S]*MONGODB_URI/);
  });

  it('defaults to the isamm email domains', () => {
    const env = loadEnv(valid);
    expect(env.allowedEmailDomains).toEqual(['isamm.uma.tn', 'isamm.u-manouba.tn']);
  });

  it('parses a custom domain list, trimmed and lowercased', () => {
    const env = loadEnv({ ...valid, ALLOWED_EMAIL_DOMAINS: ' Univ.DZ , other.edu ' });
    expect(env.allowedEmailDomains).toEqual(['univ.dz', 'other.edu']);
  });

  it('rejects an empty domain list, which would block every signup', () => {
    expect(() => loadEnv({ ...valid, ALLOWED_EMAIL_DOMAINS: '' })).toThrow(/ALLOWED_EMAIL_DOMAINS/);
  });
});

describe('agentmail config', () => {
  it('is optional outside production', () => {
    expect(loadEnv(valid).agentmail).toEqual({ apiKey: null, inboxId: null });
  });

  it('reads both values', () => {
    const env = loadEnv({
      ...valid,
      AGENTMAIL_API_KEY: 'am_test_key',
      AGENTMAIL_INBOX_ID: 'unitrace@agentmail.to',
    });
    expect(env.agentmail).toEqual({ apiKey: 'am_test_key', inboxId: 'unitrace@agentmail.to' });
  });

  it('treats a blank value as missing', () => {
    const env = loadEnv({ ...valid, AGENTMAIL_API_KEY: '', AGENTMAIL_INBOX_ID: '' });
    expect(env.agentmail).toEqual({ apiKey: null, inboxId: null });
  });

  it('is required in production, and reports both keys', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
      /AGENTMAIL_API_KEY[\s\S]*AGENTMAIL_INBOX_ID/,
    );
  });

  it('rejects an inbox id that is not an email address', () => {
    expect(() => loadEnv({ ...valid, AGENTMAIL_INBOX_ID: 'not-an-email' })).toThrow(
      /AGENTMAIL_INBOX_ID/,
    );
  });
});

describe('code hash secret', () => {
  const production = {
    ...valid,
    NODE_ENV: 'production',
    AGENTMAIL_API_KEY: 'am_test_key',
    AGENTMAIL_INBOX_ID: 'unitrace@agentmail.to',
    JWT_ACCESS_SECRET: 'j'.repeat(32),
  };

  it('falls back to a dev secret outside production', () => {
    expect(loadEnv(valid).codeHashSecret).toBeTruthy();
  });

  it('is required in production', () => {
    expect(() => loadEnv(production)).toThrow(/CODE_HASH_SECRET/);
  });

  it('must be at least 32 characters', () => {
    expect(() => loadEnv({ ...production, CODE_HASH_SECRET: 'too-short' })).toThrow(
      /CODE_HASH_SECRET/,
    );
  });

  it('accepts a strong secret in production', () => {
    const env = loadEnv({ ...production, CODE_HASH_SECRET: 'x'.repeat(32) });

    expect(env.codeHashSecret).toBe('x'.repeat(32));
  });
});

describe('jwt config', () => {
  const production = {
    ...valid,
    NODE_ENV: 'production',
    AGENTMAIL_API_KEY: 'am_test_key',
    AGENTMAIL_INBOX_ID: 'unitrace@agentmail.to',
    CODE_HASH_SECRET: 'x'.repeat(32),
  };

  it('falls back to a dev secret and a 15 minute lifetime outside production', () => {
    expect(loadEnv(valid).jwt).toEqual({
      accessSecret: expect.any(String),
      accessExpires: '15m',
    });
  });

  it('requires the secret in production', () => {
    expect(() => loadEnv(production)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('must be at least 32 characters', () => {
    expect(() => loadEnv({ ...production, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('accepts a strong secret in production', () => {
    const env = loadEnv({ ...production, JWT_ACCESS_SECRET: 'j'.repeat(32) });

    expect(env.jwt.accessSecret).toBe('j'.repeat(32));
  });

  it('accepts a custom lifetime and treats a blank one as the default', () => {
    expect(loadEnv({ ...valid, JWT_ACCESS_EXPIRES: '30m' }).jwt.accessExpires).toBe('30m');
    expect(loadEnv({ ...valid, JWT_ACCESS_EXPIRES: '' }).jwt.accessExpires).toBe('15m');
  });

  it.each(['15', 'abc', '15 m', '-5m', '1.5h'])('rejects the lifetime "%s"', (lifetime) => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_EXPIRES: lifetime })).toThrow(/JWT_ACCESS_EXPIRES/);
  });
});

describe('upload folder', () => {
  it('defaults to uploads, as an absolute path', () => {
    expect(loadEnv(valid).uploadDir).toBe(path.resolve('uploads'));
  });

  it('can be changed, and an empty value falls back to the default', () => {
    expect(loadEnv({ ...valid, UPLOAD_DIR: 'data/pictures' }).uploadDir).toBe(
      path.resolve('data/pictures'),
    );
    expect(loadEnv({ ...valid, UPLOAD_DIR: '' }).uploadDir).toBe(path.resolve('uploads'));
  });
});

describe('cors origins', () => {
  it('defaults to none, which means same origin only', () => {
    expect(loadEnv(valid).corsOrigins).toEqual([]);
    expect(loadEnv({ ...valid, CORS_ORIGINS: '' }).corsOrigins).toEqual([]);
  });

  it('parses a list, trimmed', () => {
    const env = loadEnv({
      ...valid,
      CORS_ORIGINS: ' http://localhost:5173 , https://unitrace.example ',
    });

    expect(env.corsOrigins).toEqual(['http://localhost:5173', 'https://unitrace.example']);
  });

  it.each([
    ['a wildcard', '*'],
    ['a trailing slash', 'http://localhost:5173/'],
    ['a path', 'https://unitrace.example/app'],
    ['no scheme', 'localhost:5173'],
    ['one bad entry in a good list', 'http://localhost:5173,not-an-origin'],
  ])('rejects %s', (_label, value) => {
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: value })).toThrow(/CORS_ORIGINS/);
  });
});

describe('trust proxy', () => {
  it('defaults to 0, no proxy', () => {
    expect(loadEnv(valid).trustProxy).toBe(0);
  });

  it('reads the number of proxies', () => {
    expect(loadEnv({ ...valid, TRUST_PROXY: '1' }).trustProxy).toBe(1);
  });

  it.each(['-1', 'abc', '1.5', '11'])('rejects "%s"', (value) => {
    expect(() => loadEnv({ ...valid, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
  });
});
