import path from 'node:path';
import helmet from 'helmet';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const DOCS_DIR = import.meta.dirname;

const DOC_FILES = [
  'components.yml',
  'health.yml',
  'auth.yml',
  'users.yml',
  'declarations.yml',
  'matching-api.yml',
  'search.yml',
];

const toGlobPath = (file) => path.join(DOCS_DIR, file).split(path.sep).join('/');

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'UniTrace API',
    version: '0.1.0',
    description: [
      'REST API of **UniTrace**, the lost and found platform of a university campus.',
      '',
      'This page documents the **health check, authentication, users, declarations, matching,',
      'notifications and search**. Administration is not documented here yet.',
      '',
      '### Try it',
      '1. Open `POST /api/v1/auth/login`, click **Try it out** and send a seeded account',
      '   (see `npm run seed`).',
      '2. Copy `accessToken` from the response, click **Authorize** (top right) and paste it.',
      '3. Every padlock route can now be called from this page.',
      '',
      '### Conventions',
      '- JSON everywhere. Pictures use `multipart/form-data`.',
      '- Protected routes need `Authorization: Bearer <accessToken>`.',
      '- Unknown fields are **rejected** (400), never silently ignored.',
      '- Every error has the same shape: `{ "error": { "code", "message", "details" } }`.',
      '- A rate-limited request gets **429** with a `Retry-After` header.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'Same host as this documentation' }],
  tags: [
    { name: 'Health', description: 'Liveness probe for monitoring.' },
    {
      name: 'Auth',
      description:
        'Registration with email verification, login, refresh token rotation, logout and password reset. Public routes.',
    },
    {
      name: 'Users',
      description: 'The connected user: profile, password and account deletion.',
    },
    {
      name: 'Declarations',
      description:
        'Lost and found declarations: create, read, edit, change status, delete, list mine.',
    },
    {
      name: 'Declaration pictures',
      description:
        'Pictures are served and managed by controlled routes that follow the visibility rules of the declaration.',
    },
    {
      name: 'Matching',
      description:
        'Possible matches between a lost and a found declaration: list, read with history, accept, refuse, ask for verification and confirm the handover. Visible only to the two owners and admins.',
    },
    {
      name: 'Notifications',
      description: 'The in-app notifications of the connected user: list and mark as read.',
    },
    {
      name: 'Search',
      description:
        'Combined search over declarations (filters, text, sort, pagination, facets), the values of the filter lists, and reading one declaration in its public view.',
    },
    {
      name: 'Saved searches',
      description:
        'Search criteria a user keeps to find again later: save, list and delete. At most 20 per user.',
    },
  ],
};

export const swaggerSpec = swaggerJsdoc({
  definition,
  apis: DOC_FILES.map(toGlobPath),
});

const docsContentSecurityPolicy = helmet.contentSecurityPolicy({
  directives: {
    ...helmet.contentSecurityPolicy.getDefaultDirectives(),
    'upgrade-insecure-requests': null,
  },
});

export function setupSwagger(app) {
  app.get('/api-docs.json', (req, res) => {
    res.json(swaggerSpec);
  });

  app.use(
    '/api-docs',
    docsContentSecurityPolicy,
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'UniTrace API docs',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    }),
  );
}
