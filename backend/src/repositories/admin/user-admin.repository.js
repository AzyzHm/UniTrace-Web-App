import { User } from '../../models/users/user.model.js';

// Admin-only reads of the user collection. The password is never selected, because the schema
// hides it by default and this query uses lean().
export function createAdminUserRepository({ model = User } = {}) {
  return {
    async findPage({ skip, limit }) {
      const [items, total] = await Promise.all([
        model.find({}).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
        model.countDocuments({}),
      ]);
      return { items, total };
    },
  };
}
