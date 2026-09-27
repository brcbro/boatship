export const legacyEngagementId = (clientId: string) => `onboarding_${clientId}`;
export const taskEngagementId = (task: { clientId: string; engagementId?: string }) => task.engagementId || legacyEngagementId(task.clientId);
