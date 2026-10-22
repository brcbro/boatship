/** Empty context keeps the legacy all-work view; "account" is an explicit filter. */
export function messageMatchesContext(
  message: { engagementId?: string | null },
  engagementId?: string | null,
  includeAccountWide = false
) {
  const context = message.engagementId || null;
  if (!engagementId) return true;
  if (engagementId === "account") return context === null;
  return context === engagementId || (includeAccountWide && context === null);
}
