import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { compareNullable, PRODUCTS, PRODUCT_MEMBERS, PRODUCT_WORK_ITEMS } from "@/lib/products";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const products = session.role === "admin"
      ? await PRODUCTS.find([])
      : await PRODUCTS.getMany((await PRODUCT_MEMBERS.find([{ field: "userId", op: "==", value: session.uid }])).map((m) => m.productId));
    const names = new Map(products.map((p) => [p.id, p.name]));
    const rows = products.length ? await PRODUCT_WORK_ITEMS.find([{ field: "productId", op: "in", value: products.map((p) => p.id) }]) : [];
    const open = rows.filter((row) => row.status !== "done" && row.status !== "cancelled")
      .sort((a, b) => compareNullable(a.dueDate, b.dueDate) || b.createdAt.localeCompare(a.createdAt));
    return { workItems: open.map((row) => ({ id: row.id, title: row.title, assigneeId: row.assigneeId, status: row.status, priority: row.priority, dueDate: row.dueDate, productId: row.productId, productName: names.get(row.productId) || "Unknown", source: "product" as const })) };
  });
}
