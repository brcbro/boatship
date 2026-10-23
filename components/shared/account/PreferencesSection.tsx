"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ThemePicker } from "@/components/shared/ThemeToggle";
import { Button, Hint, Label, Select } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatAccountDateTime, type AccountPreferences } from "@/lib/account-preferences";
import type { HourCycle } from "@/types";
import { ErrorText, SectionCard, SectionError, SectionSkeleton, StatusText, messageFor, useAccountResource, useSetDisplayPreferences, useUnsavedWarning } from "./shared";

const FALLBACK_ZONES = ["UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"];

function supportedTimeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list?.length) return list;
  } catch { /* older runtime */ }
  return FALLBACK_ZONES;
}

function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function PreferencesSection() {
  const preferences = useAccountResource<{ preferences: AccountPreferences }>("/api/account/preferences");
  const setShared = useSetDisplayPreferences();
  const saved = preferences.data?.preferences ?? null;

  return (
    <>
      <SectionCard title="Appearance" description="Light, dark, or whatever your device uses. This is remembered by this browser only and does not follow you to other devices.">
        <ThemePicker />
      </SectionCard>

      {preferences.loading ? <SectionSkeleton title="Time and dates" lines={2} /> : preferences.error || !saved ? <SectionError title="Time and dates" error={preferences.error || "Your preferences are unavailable."} onRetry={() => void preferences.reload()} /> : (
        <TimeForm saved={saved} onSaved={(next) => { preferences.setData({ preferences: next }); setShared(next); }} />
      )}

      <SectionCard title="Language" description="Boatship is available in English. A language choice will appear here when more are supported.">
        <p className="text-sm text-[var(--ink-muted)]">Reduced motion follows your device setting.</p>
      </SectionCard>
    </>
  );
}

function TimeForm({ saved, onSaved }: { saved: AccountPreferences; onSaved: (next: AccountPreferences) => void }) {
  const [timezone, setTimezone] = useState<string>(saved.timezone ?? "");
  const [hourCycle, setHourCycle] = useState<HourCycle | "">(saved.hourCycle ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const zones = useMemo(() => supportedTimeZones(), []);
  const detected = useMemo(() => deviceTimeZone(), []);
  const dirty = (saved.timezone ?? "") !== timezone || (saved.hourCycle ?? "") !== hourCycle;
  useUnsavedWarning(dirty);
  const preview = formatAccountDateTime(new Date().toISOString(), { timezone: timezone || null, hourCycle: hourCycle || null });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const response = await apiFetch<{ preferences: AccountPreferences }>("/api/account/preferences", { method: "PATCH", body: JSON.stringify({ timezone: timezone || null, hourCycle: hourCycle || null }) });
      onSaved(response.preferences);
      setMessage("Preferences saved.");
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Time and dates" description="How times are shown on your account pages. Deadlines that are a date only are never shifted by your timezone.">
      <form onSubmit={(event) => void save(event)} className="space-y-5" noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="pref-timezone">Timezone</Label>
            <Select id="pref-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} aria-describedby="pref-timezone-hint">
              <option value="">Follow my device{detected ? ` (${detected})` : ""}</option>
              {zones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
            </Select>
            <Hint id="pref-timezone-hint">
              {detected && timezone !== detected ? <>Your device reports <strong className="font-semibold text-[var(--ink)]">{detected}</strong>. <button type="button" className="font-medium text-[var(--brand)] hover:underline" onClick={() => setTimezone(detected)}>Use it</button>.</> : "Saved on your account, so it applies on every device once you save."}
            </Hint>
          </div>
          <fieldset>
            <legend className="mb-1.5 block text-[13px] font-semibold text-[var(--ink)]">Time format</legend>
            <div className="flex flex-wrap gap-2">
              {([["", "Device default"], ["12h", "12-hour"], ["24h", "24-hour"]] as const).map(([value, label]) => (
                <label key={value} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border px-3 text-sm font-medium ${hourCycle === value ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]" : "border-[var(--border-strong)] text-[var(--ink)]"}`}>
                  <input type="radio" name="hourCycle" value={value} checked={hourCycle === value} onChange={() => setHourCycle(value)} className="accent-[var(--brand)]" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <p className="rounded-[var(--radius-md)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink-muted)]">Preview: <span className="font-medium text-[var(--ink)]">{preview}</span></p>
        <ErrorText>{error}</ErrorText>
        <StatusText>{message}</StatusText>
        <Button type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save changes"}</Button>
      </form>
    </SectionCard>
  );
}
