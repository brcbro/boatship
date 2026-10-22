import { Collection, isFirestoreStatus } from "@/lib/firestore";
import { productReminderId } from "@/lib/product-reminder-id";
import { PRODUCTS, PRODUCT_MEMBERS, PRODUCT_MILESTONES, PRODUCT_WORK_ITEMS, productMemberId } from "@/lib/products";

/** Same shape lib/store.ts writes for NotificationRecord (ISO string timestamps). */
type NotificationDoc = {
  id: string; userId: string; kind: string; title: string; body: string; href: string | null; clientId: string | null; readAt: string | null; createdAt: string;
};
const NOTIFICATIONS = new Collection<NotificationDoc>("NotificationRecord");

const OPEN = (status: string) => status !== "done" && status !== "cancelled";

export async function scanProductReminders(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const cutoff = `${day}T00:00:00.000Z`;
  // A single range filter keeps to automatic single-field indexes; status and
  // product stage are filtered in memory.
  const [overdueWork, overdueMilestones] = await Promise.all([
    PRODUCT_WORK_ITEMS.find([{ field: "dueDate", op: "<", value: cutoff }]),
    PRODUCT_MILESTONES.find([{ field: "targetDate", op: "<", value: cutoff }]),
  ]);
  const openWork = overdueWork.filter((item) => OPEN(item.status));
  const openMilestones = overdueMilestones.filter((item) => OPEN(item.status));
  const products = new Map((await PRODUCTS.getMany([...new Set([...openWork, ...openMilestones].map((item) => item.productId))]))
    .filter((product) => product.stage !== "paused" && product.stage !== "retired").map((product) => [product.id, product]));
  const work = openWork.filter((item) => products.has(item.productId));
  const milestones = openMilestones.filter((item) => products.has(item.productId));
  let created = 0;
  for (const item of [...work.map((value) => ({ kind: "work", value, due: value.dueDate, owner: value.assigneeId })), ...milestones.map((value) => ({ kind: "milestone", value, due: value.targetDate, owner: value.ownerId }))]) {
    const { kind, value, due, owner } = item;
    const product = products.get(value.productId)!;
    const recipients = [...new Set([owner, product.ownerId].filter((id): id is string => Boolean(id)))];
    const members = await PRODUCT_MEMBERS.getMany(recipients.map((userId) => productMemberId(value.productId, userId)));
    for (const member of members) {
      const id = productReminderId(day, kind, value.id, member.userId);
      try {
        await NOTIFICATIONS.create(id, {
          id, userId: member.userId, kind: "task_overdue",
          title: `Overdue product ${kind}: ${value.title}`,
          body: `${product.name} · due ${due!.slice(0, 10)}`,
          href: `/products/${value.productId}`, clientId: null, readAt: null, createdAt: now.toISOString(),
        });
        created++;
      } catch (error) {
        if (!isFirestoreStatus(error, "ALREADY_EXISTS")) throw error;
      }
    }
  }
  return { scanned: work.length + milestones.length, created };
}
