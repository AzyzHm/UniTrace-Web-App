// Whitelist of what an admin sees about an account. Anything not listed here stays private.
export function toAdminUserSummary(user) {
  return {
    id: String(user._id),
    username: user.username,
    email: user.email,
    role: user.role,
    isEmailVerified: user.isEmailVerified,
    deletedAt: user.deletedAt ?? null,
    createdAt: user.createdAt,
  };
}
