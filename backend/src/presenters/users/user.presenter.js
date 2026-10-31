// An explicit whitelist: a field added to the User model stays private until it is added here.
// isActive and deletedAt are left out on purpose, the client has no use for them.
export function toUserResponse(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isEmailVerified: user.isEmailVerified,
    createdAt: user.createdAt,
  };
}
