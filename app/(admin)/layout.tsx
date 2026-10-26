"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import { useAuth } from "@/components/shared/AuthProvider";
import { SessionLoading, SessionRetry } from "@/components/shared/SessionStatus";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading, session, sessionError } = useAuth();

  if (loading) return <SessionLoading />;
  if (!session && sessionError) return <SessionRetry />;

  return <AdminShell>{children}</AdminShell>;
}
