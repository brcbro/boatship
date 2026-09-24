import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const rows = await getPrisma().productWorkItem.findMany({
      where: { status: { notIn: ["done", "cancelled"] }, product: session.role === "admin" ? {} : { members: { some: { userId: session.uid } } } },
      include: { product: { select: { name: true } } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    });
    return { workItems: rows.map((row) => ({ id: row.id, title: row.title, assigneeId: row.assigneeId, status: row.status, priority: row.priority, dueDate: row.dueDate, productId: row.productId, productName: row.product.name, source: "product" as const })) };
  });
}
