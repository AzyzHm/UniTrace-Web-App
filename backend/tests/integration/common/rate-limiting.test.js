import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
import { InvalidCodeError, UnauthenticatedError } from '../../../src/exceptions/app-error.js';
import { createRateLimiters } from '../../../src/middlewares/common/rate-limiters.js';

const GOOD_PASSWORD = 'Correct1pass';
const EMAIL = 'student@isamm.uma.tn';

const user = {
  id: 'u1',
  username: 'student',
  email: EMAIL,
  phone: null,
  role: 'user',
  isEmailVerified: true,
  createdAt: new Date('2026-10-01T10:00:00Z'),
};

const limit = (max) => ({ windowMs: 60_000, limit: max });

function buildApp({ limits = {}, trustProxy = 0, withLimiters = true } = {}) {
  const sessionService = {
    login: vi.fn(async ({ password }) => {
      if (password !== GOOD_PASSWORD) throw new UnauthenticatedError('Invalid email or password');
      return { user, accessToken: 'access', refreshToken: 'refresh' };
    }),
  };
  const authService = {
    register: vi.fn(async () => user),
    verifyEmail: vi.fn(async () => {
      throw new InvalidCodeError();
    }),
    resendVerification: vi.fn(async () => undefined),
  };
  const passwordResetService = {
    requestReset: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => {
      throw new InvalidCodeError();
    }),
  };
  const passwordChangeService = {
    changePassword: vi.fn(async () => {
      throw new UnauthenticatedError('Current password is incorrect');
    }),
  };
  const accountDeletionService = {
    deleteAccount: vi.fn(async () => {
      throw new UnauthenticatedError('Password is incorrect');
    }),
  };

  const app = createApp({
    authService,
    sessionService,
    passwordResetService,
    profileService: {},
    passwordChangeService,
    accountDeletionService,
    requireAuth: (req, res, next) => {
      req.user = { _id: 'u1', role: 'user', ...user };
      next();
    },
    allowedEmailDomains: ['isamm.uma.tn'],
    trustProxy,
    rateLimiters: withLimiters
      ? createRateLimiters({
          limits: {
            api: limit(1000),
            authFailures: limit(1000),
            loginAccount: limit(1000),
            emailSending: limit(1000),
            ...limits,
          },
        })
      : null,
  });

  return { app, sessionService };
}

const login = (app, { email = EMAIL, password = 'wrong-password', ip } = {}) => {
  const req = request(app).post('/api/v1/auth/login');
  if (ip) req.set('X-Forwarded-For', ip);
  return req.send({ email, password });
};

const expectRateLimited = (res) => {
  expect(res.status).toBe(429);
  expect(res.body).toEqual({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later',
      details: [],
    },
  });
  expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
};

describe('rate limiting, login of one account', () => {
  it('refuses the attempts that follow too many failures, in the usual error format', async () => {
    const { app, sessionService } = buildApp({ limits: { loginAccount: limit(3) } });

    for (let i = 0; i < 3; i += 1) {
      expect((await login(app)).status).toBe(401);
    }
    const refused = await login(app);

    expectRateLimited(refused);
    expect(sessionService.login).toHaveBeenCalledTimes(3);
  });

  it('refuses even the right password once the account is blocked from this address', async () => {
    const { app } = buildApp({ limits: { loginAccount: limit(2) } });

    await login(app);
    await login(app);

    expectRateLimited(await login(app, { password: GOOD_PASSWORD }));
  });

  it('does not count successful logins', async () => {
    const { app } = buildApp({ limits: { loginAccount: limit(2), authFailures: limit(2) } });

    for (let i = 0; i < 6; i += 1) {
      expect((await login(app, { password: GOOD_PASSWORD })).status).toBe(200);
    }
    expect((await login(app)).status).toBe(401);
  });

  it('counts each account on its own', async () => {
    const { app } = buildApp({ limits: { loginAccount: limit(2) } });

    await login(app);
    await login(app);
    expectRateLimited(await login(app));

    expect((await login(app, { email: 'other@isamm.uma.tn' })).status).toBe(401);
  });

  it('reads the email the way the login does, so another spelling is the same account', async () => {
    const { app } = buildApp({ limits: { loginAccount: limit(2) } });

    await login(app, { email: 'Student@ISAMM.uma.tn' });
    await login(app, { email: '  student@isamm.uma.tn ' });

    expectRateLimited(await login(app, { email: EMAIL }));
  });

  it('counts an address apart, so a stranger cannot lock the owner out', async () => {
    const { app } = buildApp({ limits: { loginAccount: limit(2) }, trustProxy: 1 });
    const attacker = '203.0.113.10';
    const owner = '198.51.100.20';

    await login(app, { ip: attacker });
    await login(app, { ip: attacker });
    expectRateLimited(await login(app, { ip: attacker }));

    expect((await login(app, { ip: owner })).status).toBe(401);
    expect((await login(app, { ip: owner, password: GOOD_PASSWORD })).status).toBe(200);
  });
});

describe('rate limiting, failures from one address', () => {
  it('stops an address that fails on many different accounts', async () => {
    const { app } = buildApp({ limits: { authFailures: limit(3) } });

    for (const name of ['a', 'b', 'c']) {
      expect((await login(app, { email: `${name}@isamm.uma.tn` })).status).toBe(401);
    }

    expectRateLimited(await login(app, { email: 'd@isamm.uma.tn' }));
  });

  it('counts a request with a malformed body too', async () => {
    const { app } = buildApp({ limits: { authFailures: limit(2) } });
    const bad = () => request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });

    expect((await bad()).status).toBe(400);
    expect((await bad()).status).toBe(400);

    expectRateLimited(await bad());
  });

  it('counts wrong verification codes', async () => {
    const { app } = buildApp({ limits: { authFailures: limit(2) } });
    const verify = () =>
      request(app).post('/api/v1/auth/verify-email').send({ email: EMAIL, code: '123456' });

    expect((await verify()).status).toBe(400);
    expect((await verify()).status).toBe(400);

    expectRateLimited(await verify());
  });

  it('counts wrong reset codes', async () => {
    const { app } = buildApp({ limits: { authFailures: limit(1) } });
    const reset = () =>
      request(app)
        .post('/api/v1/auth/reset-password')
        .send({ email: EMAIL, code: '123456', newPassword: 'Newpass123' });

    expect((await reset()).status).toBe(400);

    expectRateLimited(await reset());
  });

  it('shares one budget between login, the password change and the account deletion', async () => {
    const { app } = buildApp({ limits: { authFailures: limit(2) } });

    expect((await login(app)).status).toBe(401);
    const change = await request(app)
      .patch('/api/v1/users/me/password')
      .send({ currentPassword: 'wrong', newPassword: 'Newpass123', confirmPassword: 'Newpass123' });
    expect(change.status).toBe(401);

    expectRateLimited(await request(app).delete('/api/v1/users/me').send({ password: 'wrong' }));
  });
});

describe('rate limiting, routes that send an email', () => {
  it('counts every call, successful or not, across the three routes', async () => {
    const { app } = buildApp({ limits: { emailSending: limit(2) } });

    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: EMAIL });
    const resend = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: EMAIL });
    expect(forgot.status).toBe(200);
    expect(resend.status).toBe(200);

    expectRateLimited(
      await request(app).post('/api/v1/auth/forgot-password').send({ email: EMAIL }),
    );
    expectRateLimited(
      await request(app).post('/api/v1/auth/register').send({ email: 'new@isamm.uma.tn' }),
    );
  });
});

describe('rate limiting, the whole API', () => {
  it('refuses an address that sends too many requests, but never /health', async () => {
    const { app } = buildApp({ limits: { api: limit(3) } });

    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).get('/api/v1/unknown')).status).toBe(404);
    }

    expectRateLimited(await request(app).get('/api/v1/unknown'));
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('tells the client where it stands, with the standard headers only', async () => {
    const { app } = buildApp({ limits: { api: limit(5) } });

    const res = await request(app).get('/api/v1/unknown');

    expect(res.headers.ratelimit).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });
});

describe('without limiters', () => {
  it('limits nothing, so the tests of the other routes are never throttled', async () => {
    const { app } = buildApp({ withLimiters: false });

    for (let i = 0; i < 12; i += 1) {
      expect((await login(app)).status).toBe(401);
    }
  });
});

describe('createRateLimiters', () => {
  it('builds the four limiters', () => {
    const limiters = createRateLimiters();

    expect(Object.keys(limiters).sort()).toEqual([
      'api',
      'authFailures',
      'emailSending',
      'loginAccount',
    ]);
    for (const middleware of Object.values(limiters)) expect(typeof middleware).toBe('function');
  });
});
