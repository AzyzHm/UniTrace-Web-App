import { createEventBus } from '../events/common/event-bus.js';
import { createUserRepository } from '../repositories/users/user.repository.js';
import { createConsoleEmailService, createEmailService } from '../services/common/email.service.js';

export function buildCommon({ config, logger, clock, use }) {
  // The bus gets the logger so a failing listener is reported instead of silently lost.
  const eventBus = createEventBus({ logger });

  const emailService = use('emailService', () => {
    const { apiKey, inboxId } = config.agentmail ?? {};
    if (apiKey && inboxId) return createEmailService({ apiKey, inboxId });

    // Without AgentMail keys the codes are only logged, so development and tests work without an
    // email account. env.js requires the keys in production, so this fallback cannot happen there.
    logger.warn('AgentMail is not configured: verification codes are logged, not emailed');
    return createConsoleEmailService({ logger });
  });

  const userRepository = use('userRepository', createUserRepository);

  return { logger, clock, eventBus, emailService, userRepository };
}
