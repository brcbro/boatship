/** Old task-linked resources inherit their task's engagement; unlinked ones are account-wide. */
export function resourceEngagementId(resource: { clientId: string; engagementId?: string | null; taskId?: string | null }, tasks: Array<{ id: string; clientId: string; engagementId?: string }>): string | null {
  if (resource.engagementId) return resource.engagementId;
  const task = resource.taskId ? tasks.find((item) => item.id === resource.taskId && item.clientId === resource.clientId) : null;
  return task ? task.engagementId || `onboarding_${task.clientId}` : null;
}

export function resourceInEngagement(resource: { clientId: string; engagementId?: string | null; taskId?: string | null }, tasks: Array<{ id: string; clientId: string; engagementId?: string }>, selected: string | null | undefined, includeAccountWide = false): boolean {
  if (!selected) return true;
  const id = resourceEngagementId(resource, tasks);
  return selected === "account" ? id === null : id === selected || (includeAccountWide && id === null);
}
