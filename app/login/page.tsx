"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/components/shared/AuthProvider";
import { Button, Card, Input, Label } from "@/components/shared/ui";

type Mode = "login" | "forgot" | "reset";

function LoginContent() {
  const { login } = useAuth();
  const searchParams = useSearchParams();

  useEffect(() => {
    const topWindow = window.top;
    if (topWindow && window.self !== topWindow) {
      topWindow.location.replace(window.location.href);
    }
  }, []);

  const resetToken = useMemo(() => {
    return (searchParams.get("reset") || searchParams.get("token") || "").trim();
  }, [searchParams]);

  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
        : "Your workspace for client accounts, engagements, and delivery.";

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-[var(--nav-bg)] p-10 text-[var(--nav-fg)] lg:flex lg:flex-col lg:justify-between" aria-hidden="true">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[11px] bg-[var(--accent)] font-[family-name:var(--font-display)] text-[22px] font-extrabold leading-none text-[var(--on-accent)]">b</span>
          <Image src="/brand/boatship-logo-white.png" alt="" width={1432} height={370} className="h-6 w-auto" />
        </div>
        <div className="max-w-md">
          <p className="font-[family-name:var(--font-display)] text-[clamp(2.4rem,4vw,3.6rem)] font-extrabold leading-[0.98] tracking-[-0.03em] text-[var(--nav-fg-strong)]">Every client, every next step, one place.</p>
          <p className="mt-5 text-[15px] leading-7 text-[var(--nav-fg)]">Teams run onboarding and delivery here. Clients sign in to the same workspace and see exactly what is waiting for them.</p>
        </div>
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.12em] text-[var(--nav-fg)]/70">Boatship · Client OS</p>
        <span className="pointer-events-none absolute -bottom-32 -right-24 h-[26rem] w-[26rem] rounded-full border-[28px] border-[var(--accent)]/25" />
        <span className="pointer-events-none absolute -bottom-10 -right-6 h-[14rem] w-[14rem] rounded-full border-[18px] border-[var(--nav-fg-strong)]/12" />
      </aside>
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <div className="mb-5 flex items-center gap-2.5 lg:hidden">
            <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--accent)] font-[family-name:var(--font-display)] text-[19px] font-extrabold leading-none text-[var(--on-accent)]">b</span>
            <Image src="/brand/boatship-logo-black.png" alt="Boatship" width={1428} height={366} className="show-light h-5 w-auto" />
            <Image src="/brand/boatship-logo-white.png" alt="" aria-hidden="true" width={1432} height={370} className="show-dark h-5 w-auto" />
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-[2.4rem] font-extrabold leading-[1.02] tracking-[-0.03em] text-[var(--ink)]">
            {mode === "login" ? "Sign in" : title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{subtitle}</p>
        </div>

        <Card className="p-6">
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
                <div className="flex items-center justify-between gap-3"><Label htmlFor="password">Password</Label><button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-sm)] px-2 text-sm font-medium text-[var(--ink-muted)] underline underline-offset-2 hover:text-[var(--ink)]" onClick={() => setShowPassword((value) => !value)} aria-controls="password" aria-pressed={showPassword} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></div>
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
              {success ? <p role="status" className="text-sm text-[var(--success)]">{success}</p> : null}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
              <button
                type="button"
                className="min-h-11 w-full rounded-[var(--radius-md)] px-3 text-center text-sm text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
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
              {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
              {success ? <p role="status" className="text-sm text-[var(--success)]">{success}</p> : null}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>
              <button
                type="button"
                className="min-h-11 w-full rounded-[var(--radius-md)] px-3 text-center text-sm text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
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
                <div className="flex items-center justify-between gap-3"><Label htmlFor="new-password">New password</Label><button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-sm)] px-2 text-sm font-medium text-[var(--ink-muted)] underline underline-offset-2 hover:text-[var(--ink)]" onClick={() => setShowPassword((value) => !value)} aria-controls="new-password confirm-password" aria-pressed={showPassword} aria-label={showPassword ? "Hide passwords" : "Show passwords"}>{showPassword ? "Hide" : "Show"}</button></div>
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
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
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
              {success ? <p role="status" className="text-sm text-[var(--success)]">{success}</p> : null}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Saving…" : "Set password"}
              </Button>
              <button
                type="button"
                className="min-h-11 w-full rounded-[var(--radius-md)] px-3 text-center text-sm text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
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
            <p className="mt-6 text-center text-xs leading-5 text-[var(--ink-muted)]">
              Use the account created by your workspace administrator, or request a password reset.
            </p>
          ) : null}
        </Card>
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-[var(--ink-muted)] underline underline-offset-4 hover:text-[var(--ink)]">Back to Boatship home</Link>
      </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center px-4 py-10">
          <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
