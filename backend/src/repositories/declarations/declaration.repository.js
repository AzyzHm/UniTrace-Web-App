import { DECLARATION_STATUSES } from '../../constants/declarations/declaration-status.js';
import { Declaration } from '../../models/declarations/declaration.model.js';

export function createDeclarationRepository({ model = Declaration } = {}) {
  return {
    create(data) {
      return model.create(data);
    },

    findById(id) {
      return model.findById(id);
    },

    // privateInfo is hidden by the schema, so the owner views have to ask for it.
    findByIdWithPrivateInfo(id) {
      return model.findById(id).select('+privateInfo');
    },

    // expectedStatus is part of the filter. If the status changed since the service read the
    // declaration (another request, an admin), nothing matches and the result is null, which the
    // service reports as a 409. This avoids lost updates without a lock. runValidators is needed
    // because findOneAndUpdate skips schema validation by default, and privateInfo is selected
    // because the result goes back to the owner.
    updateFields(id, fields, expectedStatus) {
      return model
        .findOneAndUpdate(
          { _id: id, status: expectedStatus },
          { $set: fields },
          { returnDocument: 'after', runValidators: true },
        )
        .select('+privateInfo');
    },

    async findPageByOwner(ownerId, { type, status, skip, limit }) {
      // Soft-deleted declarations are left out unless a status filter is given.
      const filter = {
        owner: ownerId,
        status: status ?? { $ne: DECLARATION_STATUSES.DELETED },
      };
      if (type) filter.type = type;

      // _id breaks ties so pages stay stable when several declarations share one createdAt. lean()
      // because the list is read-only and goes straight to the presenter.
      const [items, total] = await Promise.all([
        model.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        model.countDocuments(filter),
      ]);

      return { items, total };
    },

    // Two steps so the caller gets what changed (id and previous status) for its events. The
    // update repeats the status condition, so a declaration that moved in between is left alone.
    async softDeleteByOwner(ownerId, fromStatuses, deletedAt) {
      const targets = await model
        .find({ owner: ownerId, status: { $in: fromStatuses } })
        .select('status')
        .lean();
      if (targets.length === 0) return [];

      await model.updateMany(
        { _id: { $in: targets.map((t) => t._id) }, status: { $in: fromStatuses } },
        { $set: { status: DECLARATION_STATUSES.DELETED, deletedAt } },
      );

      return targets.map((t) => ({ id: String(t._id), from: t.status }));
    },

    // Returns the filenames so the service can delete the files once the database is updated.
    async clearPicturesByOwner(ownerId) {
      const targets = await model
        .find({ owner: ownerId, picture: { $ne: null } })
        .select('picture')
        .lean();
      if (targets.length === 0) return [];

      const filenames = targets.map((t) => t.picture);
      await model.updateMany(
        { _id: { $in: targets.map((t) => t._id) }, picture: { $in: filenames } },
        { $set: { picture: null } },
      );

      return filenames;
    },

    // Declarations kept after the owner is deleted (matched, resolved) must not keep personal text.
    async clearPrivateInfoByOwner(ownerId) {
      const result = await model.updateMany(
        { owner: ownerId, privateInfo: { $ne: null } },
        { $set: { privateInfo: null } },
      );
      return result.modifiedCount;
    },
  };
}
