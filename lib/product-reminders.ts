import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { productReminderId } from "@/lib/product-reminder-id";

export async function scanProductReminders(now = new Date()) {
  const db = getPrisma();
  const day = now.toISOString().slice(0, 10);
  const cutoff = new Date(`${day}T00:00:00.000Z`);
  const active = { stage: { notIn: ["paused", "retired"] } };
  const [work, milestones] = await Promise.all([
    db.productWorkItem.findMany({ where: { dueDate: { lt: cutoff }, status: { notIn: ["done", "cancelled"] }, product: active }, include: { product: true } }),
    db.productMilestone.findMany({ where: { targetDate: { lt: cutoff }, status: { notIn: ["done", "cancelled"] }, product: active }, include: { product: true } }),
  ]);
  let created = 0;
  for (const item of [...work.map((value) => ({ kind: "work", value, due: value.dueDate, owner: value.assigneeId })), ...milestones.map((value) => ({ kind: "milestone", value, due: value.targetDate, owner: value.ownerId }))]) {
    const { kind, value, due, owner } = item;
    const recipients = [...new Set([owner, value.product.ownerId].filter((id): id is string => Boolean(id)))];
    const members = await db.productMember.findMany({ where: { productId: value.productId, userId: { in: recipients } }, select: { userId: true } });
    for (const member of members) {
      try {
        await db.notificationRecord.create({ data: {
          id: productReminderId(day, kind, value.id, member.userId), userId: member.userId, kind: "task_overdue",
          title: `Overdue product ${kind}: ${value.title}`,
          body: `${value.product.name} · due ${due!.toISOString().slice(0, 10)}`,
          href: `/products/${value.productId}`, createdAt: now,
        } });
        created++;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
  }
  return { scanned: work.length + milestones.length, created };
}
