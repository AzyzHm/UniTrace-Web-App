import { Report } from '../../models/admin/report.model.js';

export function createReportRepository({ model = Report } = {}) {
  return {
    create(data) {
      return model.create(data);
    },

    findById(id) {
      return model.findById(id);
    },

    findOpenBy(declarationId, reporterId) {
      return model.findOne({
        declaration: declarationId,
        reporter: reporterId,
        status: 'open',
      });
    },

    // Oldest first: the admin works the queue in the order reports came in.
    async findPageByStatus(status, { skip, limit }) {
      const [items, total] = await Promise.all([
        model.find({ status }).sort({ createdAt: 1, _id: 1 }).skip(skip).limit(limit).lean(),
        model.countDocuments({ status }),
      ]);
      return { items, total };
    },

    // The filter repeats the open status, so a report treated by someone else in the meantime
    // is not overwritten.
    markTreated(id, { status, resolution, treatedBy, treatedAt }) {
      return model.findOneAndUpdate(
        { _id: id, status: 'open' },
        { $set: { status, resolution, treatedBy, treatedAt } },
        { returnDocument: 'after', runValidators: true },
      );
    },
  };
}
