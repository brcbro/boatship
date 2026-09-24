/** The assigned staff member is the only team user with access to a client. */
export function hasClientAssignment(
  role: "admin" | "team" | "client",
  userId: string,
  ownClientId: string | null | undefined,
  requestedClientId: string,
  assignedTeamMemberId: string | null | undefined,
): boolean {
  if (role === "admin") return true;
  if (role === "client") return ownClientId === requestedClientId;
  return Boolean(assignedTeamMemberId) && assignedTeamMemberId === userId;
}
