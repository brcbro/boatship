"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Button,
  EmptyState,
  PageHeader,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import type { OnboardingTemplate } from "@/types";
import { IntakeWizard } from "@/components/clients/IntakeWizard";

type TeamUser = { uid: string; name: string; email: string; role: string };

export default function NewClientPage() {
  const { token, session } = useAuth();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [error, setError] = useState("");

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setError("");
    try {
      const [u, t] = await Promise.all([
        apiFetch<{ users: TeamUser[] }>("/api/users", { token }),
        apiFetch<{ templates: OnboardingTemplate[] }>("/api/templates", { token }),
      ]);
      setUsers(u.users);
      setTemplates(t.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load form data");
    } finally {
      setLoadingMeta(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => void loadMeta(), 0);
    return () => clearTimeout(timer);
  }, [loadMeta]);

  if (loadingMeta) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading…</p>;
  }

  if (error && users.length === 0 && templates.length === 0) {
    return (
      <EmptyState
        title="Couldn’t load form"
        description={error}
        action={
          <Button type="button" onClick={() => void loadMeta()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Create a client workspace"
        description="Capture the essentials once, then start the right onboarding playbook."
      />
      <IntakeWizard
        token={token}
        users={session?.role === "team" ? users.filter((user) => user.uid === session.uid) : users}
        templates={templates}
        defaultAssigneeId={session?.uid || users[0]?.uid || ""}
      />
    </div>
  );
}
