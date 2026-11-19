import { Router } from 'express';
import { createAdminUserController } from '../controllers/admin/admin-user.controller.js';
import { createModerationController } from '../controllers/admin/moderation.controller.js';
import { createReportController } from '../controllers/admin/report.controller.js';
import { createAuthController } from '../controllers/auth/auth.controller.js';
import { createDeclarationController } from '../controllers/declarations/declaration.controller.js';
import { createUserController } from '../controllers/users/user.controller.js';
import {
  createUploadPicture,
  parseMultipartAttributes,
  requirePicture,
} from '../middlewares/declarations/upload-picture.js';
import { createRefreshCookie } from '../utils/auth/refresh-cookie.js';
import {
  createRegisterSchema,
  forgotPasswordSchema,
  loginSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../validators/auth/auth.validator.js';
import {
  deleteUserBodySchema,
  listUsersQuerySchema,
  userIdParamsSchema,
} from '../validators/admin/admin.validator.js';
import {
  createReportBodySchema,
  listReportsQuerySchema,
  reportIdParamsSchema,
  treatReportBodySchema,
} from '../validators/admin/report.validator.js';
import {
  declarationIdParamsSchema,
  moderationBodySchema,
} from '../validators/admin/moderation.validator.js';
import {
  changeDeclarationStatusSchema,
  createDeclarationSchema,
  declarationIdParamsSchema as declarationRouteIdParamsSchema,
  listMyDeclarationsQuerySchema,
  pictureBodySchema,
  updateDeclarationSchema,
} from '../validators/declarations/declaration.validator.js';
import {
  changePasswordSchema,
  createUpdateProfileSchema,
  deleteAccountSchema,
} from '../validators/users/user.validator.js';
import { createAdminRoutes } from './admin/admin.routes.js';
import { createAuthRoutes } from './auth/auth.routes.js';
import { createDeclarationRoutes } from './declarations/declaration.routes.js';
import { createReportRoutes } from './reports/report.routes.js';
import { createUserRoutes } from './users/user.routes.js';

export function createApiRouter({
  services = {},
  requireAuth,
  allowedEmailDomains = [],
  secureCookies = false,
  rateLimiters = {},
} = {}) {
  const {
    authService,
    sessionService,
    passwordResetService,
    profileService,
    passwordChangeService,
    accountDeletionService,
    declarationService,
    adminUserService,
    reportService,
    moderationService,
  } = services;

  const router = Router();
  // One cookie helper shared by auth and users: login sets it, logout and deletion clear it.
  const refreshCookie = createRefreshCookie({ secure: secureCookies });

  // A group is mounted only when its dependencies are given, so a test can build the app with
  // just the services it needs. Only /auth is public, the other groups always sit behind requireAuth.
  if (authService) {
    router.use(
      '/auth',
      createAuthRoutes({
        authController: createAuthController({
          authService,
          sessionService,
          passwordResetService,
          refreshCookie,
        }),
        registerSchema: createRegisterSchema({ allowedEmailDomains }),
        verifyEmailSchema,
        resendVerificationSchema,
        loginSchema,
        forgotPasswordSchema,
        resetPasswordSchema,
        rateLimiters,
      }),
    );
  }

  if (requireAuth) {
    router.use(
      '/users',
      createUserRoutes({
        userController: createUserController({
          profileService,
          passwordChangeService,
          accountDeletionService,
          refreshCookie,
        }),
        requireAuth,
        updateProfileSchema: createUpdateProfileSchema({ allowedEmailDomains }),
        changePasswordSchema,
        deleteAccountSchema,
        rateLimiters,
      }),
    );
  }

  if (requireAuth && declarationService) {
    router.use(
      '/declarations',
      createDeclarationRoutes({
        declarationController: createDeclarationController({ declarationService }),
        requireAuth,
        createDeclarationSchema,
        listMyDeclarationsQuerySchema,
        declarationIdParamsSchema: declarationRouteIdParamsSchema,
        updateDeclarationSchema,
        changeDeclarationStatusSchema,
        pictureBodySchema,
        uploadPicture: createUploadPicture(),
        requirePicture,
        parseMultipartAttributes,
      }),
    );
  }

  if (requireAuth && reportService) {
    router.use(
      '/reports',
      createReportRoutes({
        reportController: createReportController({ reportService }),
        requireAuth,
        createReportBodySchema,
      }),
    );
  }

  if (requireAuth && adminUserService && reportService && moderationService) {
    router.use(
      '/admin',
      createAdminRoutes({
        controllers: {
          adminUser: createAdminUserController({ adminUserService }),
          report: createReportController({ reportService }),
          moderation: createModerationController({ moderationService }),
        },
        requireAuth,
        schemas: {
          listUsersQuery: listUsersQuerySchema,
          userIdParams: userIdParamsSchema,
          deleteUserBody: deleteUserBodySchema,
          listReportsQuery: listReportsQuerySchema,
          reportIdParams: reportIdParamsSchema,
          treatReportBody: treatReportBodySchema,
          declarationIdParams: declarationIdParamsSchema,
          moderationBody: moderationBodySchema,
        },
      }),
    );
  }

  return router;
}
