import { buildAuth } from './auth.js';
import { buildCommon } from './common.js';
import { buildDeclarations } from './declarations.js';
import { buildUsers } from './users.js';

// Default logger so the container can be built in tests without one.
const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };

export function createContainer({ config, logger = silentLogger, clock, overrides = {} }) {
  // Every replaceable part is created through use(): a test passes a fake in `overrides` (email
  // service, repository, hasher...) and the real factory is never called for it.
  const use = (name, make) => overrides[name] ?? make();

  // The order matters: auth and declarations need what common built, and users needs auth's
  // repositories and services.
  const common = buildCommon({ config, logger, clock, use });
  const auth = buildAuth({ config, common, use });
  const users = buildUsers({ common, auth });
  const declarations = buildDeclarations({ config, common, use });

  // Frozen, and limited to what the app and the tests need: the services, the auth middleware
  // and a few shared objects.
  return Object.freeze({
    services: { ...auth.services, ...users.services, ...declarations.services },
    requireAuth: auth.requireAuth,

    eventBus: common.eventBus,
    emailService: common.emailService,
    passwordHasher: auth.passwordHasher,
    tokenService: auth.tokenService,
    declarationRepository: declarations.declarationRepository,
    pictureStorage: declarations.pictureStorage,
  });
}
