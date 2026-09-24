"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Boxes, Plus } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Card, EmptyState, PageHeader, Select } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { dateLabel, label, STAGE_OPTIONS, TYPE_OPTIONS, type Product } from "./_components/types";

export default function ProductsPage() {
  const { token, session, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [type, setType] = useState("");
  const [stage, setStage] = useState("");
  const [owner, setOwner] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setProducts((await apiFetch<{ products: Product[] }>("/api/products", { token })).products); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load products"); }
    finally { setLoading(false); }
  }, [token]);
  // Auth state becomes available on the client; load the protected portfolio then.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!authLoading && token && (session?.role === "admin" || session?.role === "team")) void load(); }, [authLoading, load, session?.role, token]);
  const owners = useMemo(() => [...new Map(products.filter((p) => p.ownerId).map((p) => [p.ownerId, p.ownerName || p.ownerId])).entries()], [products]);
  const filtered = products.filter((p) => (!type || p.type === type) && (!stage || p.stage === stage) && (!owner || p.ownerId === owner));
  return <div className="space-y-6">
    <PageHeader title="Products" description="Own and ship Boatship tools and SaaS products in one place." actions={session?.role === "admin" ? <Link href="/products/new" className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"><Plus className="h-4 w-4" />New product</Link> : null} />
    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error} <button onClick={() => void load()} className="ml-2 cursor-pointer font-semibold underline">Retry</button></div> : null}
    <div className="grid gap-3 sm:grid-cols-3" aria-label="Filter products">
      <label className="text-sm font-medium">Type<Select className="mt-1" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>
      <label className="text-sm font-medium">Stage<Select className="mt-1" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>
      <label className="text-sm font-medium">Owner<Select className="mt-1" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">All owners</option>{owners.map(([id, name]) => <option key={id} value={id || ""}>{name}</option>)}</Select></label>
    </div>
    {authLoading || loading ? <p role="status" className="text-sm text-[var(--ink-muted)]">Loading products…</p> : filtered.length ? <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{filtered.map((product) => <Link key={product.id} href={`/products/${product.id}`} className="group block cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"><Card className="h-full transition-colors group-hover:border-[var(--accent)]/50"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--brand)]"><Boxes className="h-5 w-5" aria-hidden="true" /></div><h2 className="truncate text-lg font-semibold text-[var(--ink)]">{product.name}</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">{label(product.type)} · {product.ownerName || "Unassigned"}</p></div><Badge tone={product.stage === "live" ? "success" : product.stage === "paused" || product.stage === "retired" ? "neutral" : "info"}>{label(product.stage)}</Badge></div><p className="mt-4 line-clamp-2 min-h-10 text-sm leading-5 text-[var(--ink-muted)]">{product.description || "No description yet."}</p><div className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-4 text-sm"><div><p className="text-xs text-[var(--ink-muted)]">Open work</p><p className="font-semibold">{product.openWorkCount ?? 0}</p></div><div><p className="text-xs text-[var(--ink-muted)]">Current release</p><p className="font-semibold">{product.currentRelease?.version || "—"}</p></div><div className="col-span-2"><p className="text-xs text-[var(--ink-muted)]">Next milestone</p><p className="truncate font-medium">{product.nextMilestone ? `${product.nextMilestone.title} · ${dateLabel(product.nextMilestone.targetDate)}` : "No milestone planned"}</p></div></div><span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">Open workspace <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></span></Card></Link>)}</div> : <EmptyState title={products.length ? "No matching products" : "No products yet"} description={products.length ? "Try different filters." : "Create a product to start tracking its roadmap, work, and releases."} action={session?.role === "admin" && !products.length ? <Link className="text-sm font-semibold text-[var(--brand)] underline" href="/products/new">Create a product</Link> : null} />}
  </div>;
}
