import {
  DECLARATION_STATUSES,
  DEFAULT_DECLARATION_STATUS,
} from '../../constants/declarations/declaration-status.js';
import { EVENTS } from '../../constants/common/events.js';
import { isAdminRole, ROLES, SYSTEM_ACTOR } from '../../constants/common/roles.js';
import { canTransition, getAllowedTransitions } from '../../constants/declarations/transitions.js';
import { CATEGORIES } from '../../constants/declarations/categories.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../exceptions/app-error.js';

// Whitelists: owner and status are set by the server, never read from the request.
// type and privateInfo cannot be changed after creation.
const CREATABLE_FIELDS = [
  'title',
  'type',
  'description',
  'date',
  'location',
  'category',
  'attributes',
  'privateInfo',
];

const EDITABLE_FIELDS = ['title', 'description', 'date', 'location', 'category', 'attributes'];

// Owners can only edit while the declaration is open. Admins are not limited.
const OWNER_EDITABLE_STATUSES = [DECLARATION_STATUSES.PENDING, DECLARATION_STATUSES.EXPIRED];

function toPlainAttributes(attributes) {
  if (!attributes) return {};
  return attributes instanceof Map ? Object.fromEntries(attributes) : { ...attributes };
}

// Key order and Map versus object must not count as a change, otherwise a resubmitted
// form would emit a declaration.updated event for nothing.
function sameAttributes(a, b) {
  const left = Object.entries(toPlainAttributes(a)).sort(([x], [y]) => x.localeCompare(y));
  const right = Object.entries(toPlainAttributes(b)).sort(([x], [y]) => x.localeCompare(y));
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasChanged(field, stored, sent) {
  if (field === 'attributes') return !sameAttributes(stored, sent);
  if (field === 'date') return new Date(stored).getTime() !== new Date(sent).getTime();
  return stored !== sent;
}

// A hidden declaration can only go back to the status it had before being hidden
// (or be deleted), so hiding then restoring never changes its state.
function breaksRestoreRule(found, target) {
  return (
    found.status === DECLARATION_STATUSES.HIDDEN &&
    target !== DECLARATION_STATUSES.DELETED &&
    Boolean(found.statusBeforeHidden) &&
    target !== found.statusBeforeHidden
  );
}

function listAllowedTransitions(user, found) {
  const isOwner = String(found.owner) === String(user._id);
  const isAdmin = isAdminRole(user.role);
  if (!isOwner && !isAdmin) return [];

  const actor = isAdmin ? ROLES.ADMIN : ROLES.USER;
  return getAllowedTransitions(found.status, actor).filter((to) => !breaksRestoreRule(found, to));
}

export function createDeclarationService({
  declarationRepository,
  userRepository,
  eventBus,
  pictureStorage = null,
  clock = () => new Date(),
}) {
  if (!declarationRepository || !userRepository || !eventBus) {
    throw new Error(
      'createDeclarationService(): declarationRepository, userRepository and eventBus are required',
    );
  }

  function storage() {
    if (!pictureStorage) throw new Error('createDeclarationService(): pictureStorage is required');
    return pictureStorage;
  }

  // Hidden declarations answer 404 to other users, like a deleted one: they must not
  // learn that it exists.
  const notFound = () => new NotFoundError('Declaration not found');

  async function isOwnerDeleted(ownerId) {
    const owner = await userRepository.findById(ownerId);
    return !owner || Boolean(owner.deletedAt);
  }

  async function loadForEdit(user, id) {
    const found = await declarationRepository.findById(id);
    if (!found || found.status === DECLARATION_STATUSES.DELETED) throw notFound();

    const isOwner = String(found.owner) === String(user._id);
    const isAdmin = isAdminRole(user.role);

    if (!isOwner && !isAdmin) {
      if (found.status === DECLARATION_STATUSES.HIDDEN) throw notFound();
      throw new ForbiddenError('You are not allowed to edit this declaration');
    }

    if (!isAdmin && !OWNER_EDITABLE_STATUSES.includes(found.status)) {
      throw new ForbiddenError(`A ${found.status} declaration cannot be edited`);
    }

    return found;
  }

  async function commitStatusChange({ id, found, target, actor, reason }) {
    const from = found.status;
    const previousPicture = found.picture;

    const changes = {
      status: target,
      statusBeforeHidden: target === DECLARATION_STATUSES.HIDDEN ? from : null,
    };
    if (target === DECLARATION_STATUSES.DELETED) {
      changes.deletedAt = clock();
      changes.privateInfo = null;
      if (previousPicture) changes.picture = null;
    }

    // The update only matches if the status is still `from`: two actors changing the status
    // at the same time cannot both succeed.
    const updated = await declarationRepository.updateFields(id, changes, from);
    if (!updated) {
      throw new ConflictError('The declaration changed in the meantime, please reload it');
    }

    // The file goes after the database update, so a failure never leaves a record pointing
    // at a missing picture.
    if (target === DECLARATION_STATUSES.DELETED && previousPicture && pictureStorage) {
      await pictureStorage.remove(previousPicture);
    }

    await eventBus.emit(EVENTS.DECLARATION_STATUS_CHANGED, {
      declarationId: String(updated._id),
      ownerId: String(found.owner),
      from,
      to: target,
      actor,
      ...(reason && { reason }),
    });

    return updated;
  }

  async function changeStatus(user, id, target) {
    const found = await declarationRepository.findById(id);
    if (!found || found.status === DECLARATION_STATUSES.DELETED) throw notFound();

    const isOwner = String(found.owner) === String(user._id);
    const isAdmin = isAdminRole(user.role);

    if (!isOwner && !isAdmin) {
      if (found.status === DECLARATION_STATUSES.HIDDEN) throw notFound();
      throw new ForbiddenError('You are not allowed to change the status of this declaration');
    }

    const from = found.status;
    const actor = isAdmin ? ROLES.ADMIN : ROLES.USER;

    if (from === target) throw new ConflictError(`The declaration is already ${from}`);

    if (!canTransition(from, target, actor)) {
      // 403 when an admin could do it, 409 when nobody can.
      if (!isAdmin && canTransition(from, target, ROLES.ADMIN)) {
        throw new ForbiddenError(`Only an admin can change a ${from} declaration to ${target}`);
      }
      throw new ConflictError(`A ${from} declaration cannot become ${target}`);
    }

    if (breaksRestoreRule(found, target)) {
      throw new ConflictError(
        `A hidden declaration can only be restored to ${found.statusBeforeHidden}`,
      );
    }

    return commitStatusChange({ id, found, target, actor, reason: undefined });
  }

  // Entry point for the system-only transitions (matched, expired, back to pending).
  // No caller in src yet.
  async function changeStatusAsSystem(id, target, { reason } = {}) {
    const found = await declarationRepository.findById(id);
    if (!found || found.status === DECLARATION_STATUSES.DELETED) throw notFound();

    const from = found.status;
    if (from === target) throw new ConflictError(`The declaration is already ${from}`);

    if (!canTransition(from, target, SYSTEM_ACTOR)) {
      throw new ConflictError(`The system cannot change a ${from} declaration to ${target}`);
    }

    return commitStatusChange({ id, found, target, actor: SYSTEM_ACTOR, reason });
  }

  return {
    async create(user, input, picture = null) {
      const data = {};
      for (const field of CREATABLE_FIELDS) {
        if (input[field] !== undefined) data[field] = input[field];
      }

      // The picture is saved first and removed if the insert fails, so no file is orphaned.
      const filename = picture ? await storage().save(picture) : null;

      let declaration;
      try {
        declaration = await declarationRepository.create({
          ...data,
          ...(filename && { picture: filename }),
          owner: user._id,
          status: DEFAULT_DECLARATION_STATUS,
        });
      } catch (err) {
        if (filename) await pictureStorage.remove(filename);
        throw err;
      }

      await eventBus.emit(EVENTS.DECLARATION_CREATED, {
        declarationId: String(declaration._id),
        ownerId: String(user._id),
        type: declaration.type,
        category: declaration.category,
      });

      return declaration;
    },

    async listMine(user, { page, limit, type, status }) {
      const { items, total } = await declarationRepository.findPageByOwner(user._id, {
        type,
        status,
        skip: (page - 1) * limit,
        limit,
      });

      return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
    },

    async getById(user, id) {
      const found = await declarationRepository.findById(id);
      if (!found || found.status === DECLARATION_STATUSES.DELETED) throw notFound();

      const isOwner = String(found.owner) === String(user._id);
      const canSeePrivate = isOwner || isAdminRole(user.role);

      // privateInfo is select:false: only the owner and admins reload the document with it.
      if (!canSeePrivate) {
        if (found.status === DECLARATION_STATUSES.HIDDEN) throw notFound();

        return {
          declaration: found,
          isOwner: false,
          canSeePrivate: false,
          ownerDeleted: await isOwnerDeleted(found.owner),
          allowedTransitions: [],
        };
      }

      const full = await declarationRepository.findByIdWithPrivateInfo(id);
      if (!full || full.status === DECLARATION_STATUSES.DELETED) throw notFound();

      return {
        declaration: full,
        isOwner,
        canSeePrivate: true,
        ownerDeleted: isOwner ? false : await isOwnerDeleted(full.owner),
        allowedTransitions: listAllowedTransitions(user, full),
      };
    },

    async update(user, id, input) {
      const found = await loadForEdit(user, id);

      const changes = {};
      for (const field of EDITABLE_FIELDS) {
        if (input[field] !== undefined && hasChanged(field, found[field], input[field])) {
          changes[field] = input[field];
        }
      }
      const changedFields = Object.keys(changes);

      // Nothing really changed: no write and no event.
      if (changedFields.length === 0) {
        const unchanged = await declarationRepository.findByIdWithPrivateInfo(id);
        if (!unchanged || unchanged.status === DECLARATION_STATUSES.DELETED) throw notFound();
        return unchanged;
      }

      const updated = await declarationRepository.updateFields(id, changes, found.status);
      if (!updated) {
        throw new ConflictError('The declaration changed in the meantime, please reload it');
      }

      await eventBus.emit(EVENTS.DECLARATION_UPDATED, {
        declarationId: String(updated._id),
        ownerId: String(found.owner),
        changedFields,
      });

      return updated;
    },

    async setPicture(user, id, picture) {
      const found = await loadForEdit(user, id);

      // The old file is removed only once the new one is saved and the record updated.
      const previous = found.picture;
      const filename = await storage().save(picture);
      let updated;
      try {
        updated = await declarationRepository.updateFields(id, { picture: filename }, found.status);
      } catch (err) {
        await pictureStorage.remove(filename);
        throw err;
      }
      if (!updated) {
        await pictureStorage.remove(filename);
        throw new ConflictError('The declaration changed in the meantime, please reload it');
      }

      if (previous) await pictureStorage.remove(previous);

      await eventBus.emit(EVENTS.DECLARATION_UPDATED, {
        declarationId: String(updated._id),
        ownerId: String(found.owner),
        changedFields: ['picture'],
      });

      return updated;
    },

    async removePicture(user, id) {
      const found = await loadForEdit(user, id);

      if (!found.picture) {
        const unchanged = await declarationRepository.findByIdWithPrivateInfo(id);
        if (!unchanged || unchanged.status === DECLARATION_STATUSES.DELETED) throw notFound();
        return unchanged;
      }

      const previous = found.picture;
      const updated = await declarationRepository.updateFields(id, { picture: null }, found.status);
      if (!updated) {
        throw new ConflictError('The declaration changed in the meantime, please reload it');
      }

      await storage().remove(previous);

      await eventBus.emit(EVENTS.DECLARATION_UPDATED, {
        declarationId: String(updated._id),
        ownerId: String(found.owner),
        changedFields: ['picture'],
      });

      return updated;
    },

    async getPicture(user, id) {
      const notFoundPicture = () => new NotFoundError('Picture not found');

      const found = await declarationRepository.findById(id);
      if (!found || found.status === DECLARATION_STATUSES.DELETED || !found.picture) {
        throw notFoundPicture();
      }

      const canSeePrivate = String(found.owner) === String(user._id) || isAdminRole(user.role);
      // Every refusal is the same 404, so a picture cannot be probed for. Pictures of
      // sensitive categories (student cards) are never shown to other users.
      if (!canSeePrivate) {
        if (found.status === DECLARATION_STATUSES.HIDDEN) throw notFoundPicture();
        if (CATEGORIES[found.category]?.sensitive === true) throw notFoundPicture();
      }

      const filePath = storage().resolve(found.picture);
      const contentType = storage().contentTypeOf(found.picture);
      if (!filePath || !contentType) throw notFoundPicture();

      return { filePath, contentType };
    },

    changeStatus,

    changeStatusAsSystem,

    remove(user, id) {
      return changeStatus(user, id, DECLARATION_STATUSES.DELETED);
    },
  };
}
