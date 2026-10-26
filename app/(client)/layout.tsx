"use client";

import { ClientShell } from "@/components/client/ClientShell";
import { useAuth } from "@/components/shared/AuthProvider";
import { SessionRetry } from "@/components/shared/SessionStatus";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const { loading, session, sessionError } = useAuth();

  // Portal pages show their own loading state while the session is checked.
  if (!loading && !session && sessionError) return <SessionRetry />;

  return <ClientShell>{children}</ClientShell>;
}
