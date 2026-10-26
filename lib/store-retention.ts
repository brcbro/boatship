import type { ActivityLog, AppNotification, IntegrationRun, WebhookDelivery } from "@/types";

/**
 * Retention for the StoreSnapshot slices that only ever grow. Every slice is
 * rewritten whole on each change, so unbounded growth costs every later
 * write (and, on the Firestore fallback, eventually hits the document cap).
 * Applied on write by the store's `mutate`; pure and deterministic for a
 * given `nowMs`, so a retried mutation prunes the same way.
 *
 * `messages` are deliberately not pruned: they are the client conversation
 * record. Moving them to a per-record collection is the planned migration.
 */
const DAY_MS = 86_400_000;

/** Succeeded or permanently failed deliveries are dropped after this many days. */
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;
/** Hard cap on retained deliveries; pending and leased ones are never dropped. */
export const WEBHOOK_DELIVERY_MAX = 2_000;
/** Most recent integration runs kept (the integrations page shows the latest 50). */
export const INTEGRATION_RUN_MAX = 500;
/** Read notifications are kept this many days after being read; unread ones stay. */
export const NOTIFICATION_READ_RETENTION_DAYS = 30;
/**
 * Activity entries kept in the snapshot. Older ones move to the
 * `ActivityArchive` collection (see `lib/store.ts`) rather than being
 * deleted, so the audit export can still include them on request.
 */
export const ACTIVITY_SNAPSHOT_MAX = 3_000;
/** Most entries archived by one mutation, inside one transaction's write budget. */
export const ACTIVITY_ARCHIVE_BATCH = 200;

type Retained = {
  webhookDeliveries: WebhookDelivery[];
  integrationRuns: IntegrationRun[];
  notifications: AppNotification[];
  activity: ActivityLog[];
};

const finished = (delivery: WebhookDelivery) => delivery.state === undefined || delivery.state === "succeeded" || delivery.state === "failed";
const time = (value: string | null | undefined) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Oldest-first indices of the items matching `eligible`. */
function oldestIndices<T>(items: T[], eligible: (item: T) => boolean, stamp: (item: T) => number): number[] {
  return items.flatMap((item, index) => (eligible(item) ? [index] : [])).sort((a, b) => stamp(items[a]) - stamp(items[b]) || a - b);
}

function withoutIndices<T>(items: T[], drop: Set<number>): T[] {
  return drop.size ? items.filter((_, index) => !drop.has(index)) : items;
}

export function pruneWebhookDeliveries(deliveries: WebhookDelivery[], nowMs: number): WebhookDelivery[] {
  const cutoff = nowMs - WEBHOOK_DELIVERY_RETENTION_DAYS * DAY_MS;
  const kept = deliveries.filter((delivery) => !finished(delivery) || time(delivery.createdAt) >= cutoff);
  if (kept.length <= WEBHOOK_DELIVERY_MAX) return kept.length === deliveries.length ? deliveries : kept;
  const excess = oldestIndices(kept, finished, (delivery) => time(delivery.createdAt)).slice(0, kept.length - WEBHOOK_DELIVERY_MAX);
  return withoutIndices(kept, new Set(excess));
}

export function pruneIntegrationRuns(runs: IntegrationRun[]): IntegrationRun[] {
  if (runs.length <= INTEGRATION_RUN_MAX) return runs;
  const excess = oldestIndices(runs, () => true, (run) => time(run.createdAt)).slice(0, runs.length - INTEGRATION_RUN_MAX);
  return withoutIndices(runs, new Set(excess));
}

export function pruneNotifications(notifications: AppNotification[], nowMs: number): AppNotification[] {
  const cutoff = nowMs - NOTIFICATION_READ_RETENTION_DAYS * DAY_MS;
  const kept = notifications.filter((notification) => !notification.readAt || time(notification.readAt) >= cutoff);
  return kept.length === notifications.length ? notifications : kept;
}

/** Splits the oldest overflow (at most one batch) off the snapshot activity. */
export function splitActivityOverflow(activity: ActivityLog[]): { kept: ActivityLog[]; archived: ActivityLog[] } {
  if (activity.length <= ACTIVITY_SNAPSHOT_MAX) return { kept: activity, archived: [] };
  const overflow = oldestIndices(activity, () => true, (entry) => time(entry.timestamp)).slice(0, Math.min(ACTIVITY_ARCHIVE_BATCH, activity.length - ACTIVITY_SNAPSHOT_MAX));
  const drop = new Set(overflow);
  return { kept: withoutIndices(activity, drop), archived: overflow.map((index) => activity[index]) };
}

/**
 * Prunes the growing slices in place. With `archiveActivity` the activity
 * overflow is removed and returned for the caller to persist elsewhere;
 * without it activity is left untouched (the local demo has no archive).
 */
export function applyRetention(data: Retained, nowMs: number, options: { archiveActivity: boolean }): { archivedActivity: ActivityLog[] } {
  data.webhookDeliveries = pruneWebhookDeliveries(data.webhookDeliveries, nowMs);
  data.integrationRuns = pruneIntegrationRuns(data.integrationRuns);
  data.notifications = pruneNotifications(data.notifications, nowMs);
  if (!options.archiveActivity) return { archivedActivity: [] };
  const { kept, archived } = splitActivityOverflow(data.activity);
  data.activity = kept;
  return { archivedActivity: archived };
}
