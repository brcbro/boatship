"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Card, EmptyState, PageHeader } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import type { ClientWithProgress, Task } from "@/types";

type TeamUser = { uid: string; name: string; email: string; role: string };
type ProductWorkItem = {
  id: string;
  title: string;
  assigneeId: string | null;
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  productId: string;
  productName: string;
  source: "product";
};
type WorkloadRow = {
  uid: string;
  name: string;
  email: string;
  role: string;
  clientCount: number;
  productCount: number;
  openCount: number;
  urgentCount: number;
  overdueCount: number;
};

export default function WorkloadPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [productWork, setProductWork] = useState<ProductWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [productError, setProductError] = useState("");
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setProductError("");
    try {
      const [usersData, clientsData, productResult] = await Promise.all([
        apiFetch<{ users: TeamUser[] }>("/api/users", { token }),
        apiFetch<{ clients: ClientWithProgress[] }>("/api/clients", { token }),
        apiFetch<{ workItems: ProductWorkItem[] }>("/api/products/workload", { token }).then(
          (value) => ({ ok: true as const, value }),
          () => ({ ok: false as const })
        ),
      ]);
      setUsers(usersData.users);
      if (productResult.ok) {
        setProductWork(productResult.value.workItems);
      } else {
        setProductWork([]);
        setProductError("Product work is unavailable right now.");
      }
      const taskResults = await Promise.all(
        clientsData.clients.map((client) =>
          apiFetch<{ tasks: Task[] }>(`/api/tasks?clientId=${encodeURIComponent(client.id)}`, { token })
        )
      );
      setTasks(taskResults.flatMap((result) => result.tasks));
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workload");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const rows = useMemo(() => {
    const clientByAssignee = new Map<string, Task[]>();
    const productByAssignee = new Map<string, ProductWorkItem[]>();
    for (const task of tasks) {
      if (task.status === "completed" || !task.assignedTo) continue;
      const assigned = clientByAssignee.get(task.assignedTo) || [];
      assigned.push(task);
      clientByAssignee.set(task.assignedTo, assigned);
    }
    for (const item of productWork) {
      if (!item.assigneeId) continue;
      const assigned = productByAssignee.get(item.assigneeId) || [];
      assigned.push(item);
      productByAssignee.set(item.assigneeId, assigned);
    }
    const result: WorkloadRow[] = users.map((user) => {
      const clientAssigned = clientByAssignee.get(user.uid) || [];
      const productAssigned = productByAssignee.get(user.uid) || [];
      return {
        uid: user.uid,
        name: user.name,
        email: user.email,
        role: user.role,
        clientCount: clientAssigned.length,
        productCount: productAssigned.length,
        openCount: clientAssigned.length + productAssigned.length,
        urgentCount:
          clientAssigned.filter((task) => task.priority === "urgent" || task.priority === "high").length +
          productAssigned.filter((item) => item.priority === "urgent" || item.priority === "high").length,
        overdueCount:
          clientAssigned.filter((task) => task.dueDate && new Date(task.dueDate).getTime() < now).length +
          productAssigned.filter((item) => item.dueDate && new Date(item.dueDate).getTime() < now).length,
      };
    });
    return result.sort((a, b) => b.openCount - a.openCount || a.name.localeCompare(b.name));
  }, [users, tasks, productWork, now]);

  const unassignedClient = tasks.filter((task) => task.status !== "completed" && !task.assignedTo).length;
  const unassignedProduct = productWork.filter((item) => !item.assigneeId).length;

  if (loading) return <p className="text-sm text-[var(--ink-muted)]">Loading workload…</p>;
  if (error && users.length === 0) return <EmptyState title="Couldn’t load workload" description={error} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Workload" description="Open client tasks and company product work assigned to each team member." />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {productError ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{productError} Client workload is still shown.</p> : null}
      <div className="flex flex-wrap gap-3 text-sm text-[var(--ink-muted)]">
        <span>Team members: <strong className="text-[var(--ink)]">{users.length}</strong></span>
        <span>·</span>
        <span>Open client tasks: <strong className="text-[var(--ink)]">{tasks.filter((task) => task.status !== "completed").length}</strong></span>
        <span>·</span>
        <span>Open product work: <strong className="text-[var(--ink)]">{productWork.length}</strong></span>
        <span>·</span>
        <span>Unassigned: <strong className="text-[var(--ink)]">{unassignedClient} client · {unassignedProduct} product</strong></span>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No team members" description="Invite staff from the Team page." />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.uid}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--ink)]">{row.name}</p>
                  <p className="truncate text-sm text-[var(--ink-muted)]">{row.email} · {row.role}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.openCount > 0 ? "info" : "neutral"}>{row.openCount} total open</Badge>
                  <Badge tone={row.clientCount > 0 ? "info" : "neutral"}>{row.clientCount} client</Badge>
                  <Badge tone={row.productCount > 0 ? "success" : "neutral"}>{row.productCount} product</Badge>
                  {row.urgentCount > 0 ? <Badge tone="warning">{row.urgentCount} high/urgent</Badge> : null}
                  {row.overdueCount > 0 ? <Badge tone="danger">{row.overdueCount} overdue</Badge> : null}
                  <Link href="/clients" className="text-sm font-medium text-[var(--brand)] hover:underline">View clients</Link>
                  <Link href="/products" className="text-sm font-medium text-[var(--brand)] hover:underline">View products</Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
