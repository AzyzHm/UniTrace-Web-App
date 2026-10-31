import { DECLARATION_STATUSES as S } from '../../constants/declarations/declaration-status.js';
import { EVENTS } from '../../constants/common/events.js';
import { SYSTEM_ACTOR } from '../../constants/common/roles.js';

// Only these are deleted with their owner. The other statuses stay for history, but
// their private info and pictures are still wiped.
const DELETED_WITH_OWNER = Object.freeze([S.PENDING, S.EXPIRED]);

export function createDeclarationCleanupService({
  declarationRepository,
  eventBus,
  pictureStorage = null,
}) {
  if (!declarationRepository) {
    throw new Error('createDeclarationCleanupService(): declarationRepository is required');
  }
  if (!eventBus) {
    throw new Error('createDeclarationCleanupService(): eventBus is required');
  }

  async function removePictures(userId) {
    if (!pictureStorage) return;

    const filenames = await declarationRepository.clearPicturesByOwner(userId);
    await Promise.all(filenames.map((filename) => pictureStorage.remove(filename)));
  }

  return {
    async handleOwnerDeleted({ userId, deletedAt }) {
      // allSettled: one failing step must not stop the others. The first failure is
      // rethrown at the end so it is not lost.
      const [wiped, removed, pictures] = await Promise.allSettled([
        declarationRepository.clearPrivateInfoByOwner(userId),
        declarationRepository.softDeleteByOwner(userId, DELETED_WITH_OWNER, deletedAt),
        removePictures(userId),
      ]);

      if (removed.status === 'fulfilled') {
        await Promise.all(
          removed.value.map(({ id, from }) =>
            eventBus.emit(EVENTS.DECLARATION_STATUS_CHANGED, {
              declarationId: id,
              ownerId: String(userId),
              from,
              to: S.DELETED,
              actor: SYSTEM_ACTOR,
              reason: 'owner_deleted',
            }),
          ),
        );
      }

      const failure = [wiped, removed, pictures].find((result) => result.status === 'rejected');
      if (failure) throw failure.reason;
    },
  };
}
