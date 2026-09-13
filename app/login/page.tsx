"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/shared/AuthProvider";
import { Button, Card, Input, Label } from "@/components/shared/ui";

type Mode = "login" | "forgot" | "reset";

function LoginContent() {
  const { login } = useAuth();
  const searchParams = useSearchParams();
  const resetToken = useMemo(() => {
    return (searchParams.get("reset") || searchParams.get("token") || "").trim();
  }, [searchParams]);

  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Unable to send reset email");
      setSuccess("If an account exists for that email, a reset link has been sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send reset email");
    } finally {
      setLoading(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!resetToken) {
      setError("Missing reset token");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        email?: string;
      };
      if (!res.ok) throw new Error(data.error || "Unable to set password");
      if (data.email) setEmail(data.email);
      setPassword("");
      setConfirmPassword("");
      setSuccess("Password updated. You can sign in now.");
      setMode("login");
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/login");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to set password");
    } finally {
      setLoading(false);
    }
  }

  const title =
    mode === "forgot"
      ? "Reset password"
      : mode === "reset"
        ? "Set a new password"
        : "Boatship";

  const subtitle =
    mode === "forgot"
      ? "Enter your email and we’ll send a reset link if an account exists."
      : mode === "reset"
        ? "Choose a password to finish inviting or resetting your account."
        : "Connected onboarding for websites, apps, marketing, content, and growth campaigns.";

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand)] p-3 shadow-lg shadow-slate-900/10">
            <img src="/brand/boatship-b-white.png" alt="Boatship" className="h-full w-full object-contain" />
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--brand)]">
            {title}
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">{subtitle}</p>
        </div>

        <Card>
          {mode === "login" ? (
            <form onSubmit={onLogin} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
                onClick={() => {
                  setError("");
                  setSuccess("");
                  setMode("forgot");
                }}
              >
                Forgot password?
              </button>
            </form>
          ) : null}

          {mode === "forgot" ? (
            <form onSubmit={onForgot} className="space-y-4">
              <div>
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
                onClick={() => {
                  setError("");
                  setSuccess("");
                  setMode("login");
                }}
              >
                Back to sign in
              </button>
            </form>
          ) : null}

          {mode === "reset" ? (
            <form onSubmit={onReset} className="space-y-4">
              <div>
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div>
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Saving…" : "Set password"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
                onClick={() => {
                  setError("");
                  setSuccess("");
                  setMode("login");
                }}
              >
                Back to sign in
              </button>
            </form>
          ) : null}

          {mode === "login" ? (
            <p className="mt-6 text-center text-xs text-[var(--ink-muted)]">
              Use the account created by your workspace administrator, or request a password reset.
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
