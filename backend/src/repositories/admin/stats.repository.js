import { Declaration } from '../../models/declarations/declaration.model.js';
import { Report } from '../../models/admin/report.model.js';
import { User } from '../../models/users/user.model.js';

// Every figure is a MongoDB aggregation, so the counts never load documents into Node.
export function createStatsRepository({
  UserModel = User,
  DeclarationModel = Declaration,
  ReportModel = Report,
} = {}) {
  return {
    countActiveUsers() {
      return UserModel.countDocuments({ deletedAt: null });
    },

    declarationsByTypeAndStatus() {
      return DeclarationModel.aggregate([
        { $match: { deletedAt: null } },
        { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
      ]);
    },

    reportsByStatus() {
      return ReportModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    },

    // One row per day that has at least one declaration. Days with none are not returned.
    // $dateToString works in UTC.
    declarationsPerDay({ from, to }) {
      return DeclarationModel.aggregate([
        { $match: { deletedAt: null, createdAt: { $gte: from, $lt: to } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);
    },
  };
}
