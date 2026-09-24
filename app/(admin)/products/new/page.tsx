"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/shared/AuthProvider";
import { Button, Card, Input, Label, PageHeader, Select, Textarea } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { STAGE_OPTIONS, TYPE_OPTIONS, type Product, type ProductStage, type ProductType } from "../_components/types";

type StaffUser = { uid: string; name: string; email: string; role: string };

export default function NewProductPage() {
  const router = useRouter();
  const { token, session, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<ProductType>("saas");
  const [stage, setStage] = useState<ProductStage>("idea");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [staffWarning, setStaffWarning] = useState("");
  useEffect(() => {
    if (authLoading || session?.role !== "admin" || !token) return;
    let active = true;
    void apiFetch<{ users: StaffUser[] }>("/api/users", { token })
      .then((data) => { if (active) setUsers(data.users.filter((user) => user.role !== "client")); })
      .catch(() => { if (active) setStaffWarning("Staff members could not be loaded. You can still create the product with yourself as owner."); });
    return () => { active = false; };
  }, [authLoading, session?.role, token]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !name.trim() || !token) return;
    setSaving(true); setError("");
    try {
      const data = await apiFetch<{ product: Product }>("/api/products", { method: "POST", token, body: JSON.stringify({ name: name.trim(), type, stage, description: description.trim(), ownerId: ownerId || undefined, websiteUrl: websiteUrl.trim() || null }) });
      router.replace(`/products/${data.product.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create product");
      setSaving(false);
    }
  }
  if (authLoading) return <p role="status" className="text-sm text-[var(--ink-muted)]">Loading your workspace…</p>;
  if (session?.role !== "admin") return <div><PageHeader title="New product" /><Card>Only admins can create products.</Card></div>;
  return <div className="max-w-3xl"><PageHeader title="New product" description="Set up a Boatship owned tool or SaaS product. Add milestones and work after creation." actions={<Link href="/products" className="text-sm font-medium text-[var(--brand)] underline">Back to products</Link>} />
    <Card><form onSubmit={(event) => void submit(event)} className="space-y-5">
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {staffWarning ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{staffWarning}</p> : null}
      <div><Label htmlFor="product-name">Product name</Label><Input id="product-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Boatship Insights" /></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="product-type">Type</Label><Select id="product-type" value={type} onChange={(event) => setType(event.target.value as ProductType)}>{TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></div><div><Label htmlFor="product-stage">Stage</Label><Select id="product-stage" value={stage} onChange={(event) => setStage(event.target.value as ProductStage)}>{STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></div></div>
      <div><Label htmlFor="product-description">Description</Label><Textarea id="product-description" rows={4} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does this product do, and who is it for?" /></div>
      <div><Label htmlFor="product-owner">Owner</Label><Select id="product-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">Me (default)</option>{users.map((user) => <option key={user.uid} value={user.uid}>{user.name}</option>)}</Select><p className="mt-1 text-xs text-[var(--ink-muted)]">Only assigned product members can access this workspace.</p></div>
      <div><Label htmlFor="product-url">Website URL (optional)</Label><Input id="product-url" type="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://example.com" /></div>
      <div className="flex flex-wrap gap-3 border-t border-[var(--border)] pt-5"><Button type="submit" disabled={saving || !name.trim()}>{saving ? "Creating…" : "Create product"}</Button><Link href="/products" className="inline-flex min-h-10 items-center rounded-lg px-4 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]">Cancel</Link></div>
    </form></Card>
  </div>;
}
