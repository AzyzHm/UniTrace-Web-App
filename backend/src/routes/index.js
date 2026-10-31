import { Router } from 'express';
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
  changeDeclarationStatusSchema,
  createDeclarationSchema,
  declarationIdParamsSchema,
  listMyDeclarationsQuerySchema,
  pictureBodySchema,
  updateDeclarationSchema,
} from '../validators/declarations/declaration.validator.js';
import {
  changePasswordSchema,
  createUpdateProfileSchema,
  deleteAccountSchema,
} from '../validators/users/user.validator.js';
import { createAuthRoutes } from './auth/auth.routes.js';
import { createDeclarationRoutes } from './declarations/declaration.routes.js';
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
  } = services;

  const router = Router();
  // One cookie helper shared by auth and users: login sets it, logout and deletion clear it.
  const refreshCookie = createRefreshCookie({ secure: secureCookies });

  // A group is mounted only when its dependencies are given, so a test can build the app with
  // just the services it needs. Only /auth is public, the other two always sit behind requireAuth.
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
        declarationIdParamsSchema,
        updateDeclarationSchema,
        changeDeclarationStatusSchema,
        pictureBodySchema,
        uploadPicture: createUploadPicture(),
        requirePicture,
        parseMultipartAttributes,
      }),
    );
  }

  return router;
}
