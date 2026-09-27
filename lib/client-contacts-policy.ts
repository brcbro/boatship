export function isCurrentPrimaryContact(contactEmail: string, primaryEmail: string | undefined) {
  return contactEmail.toLowerCase() === primaryEmail?.toLowerCase();
}
