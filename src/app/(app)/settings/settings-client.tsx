"use client";

import * as React from "react";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, SaveStatus, type SaveState } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/inputs";

interface Profile {
  fullName: string | null;
  email: string;
  timezone: string;
  locale: string;
  notificationPrefs: Record<string, boolean>;
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
  createdAt: string;
}

const NOTIFICATIONS = [
  { key: "checkinReminders", label: "Check-in reminders", description: "Emails before each check-in is due and when one is overdue." },
  { key: "securityAlerts", label: "Security alerts", description: "New sign-ins, password changes and recovery activity." },
  { key: "releaseAlerts", label: "Release alerts", description: "When a release case opens, is verified, or content is delivered." },
  { key: "productUpdates", label: "Product updates", description: "Occasional news about AfterKey. Never about your vault contents." },
] as const;

/** Profile settings: name, timezone and notification preferences. */
export function SettingsClient() {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [fullName, setFullName] = React.useState("");
  const [timezone, setTimezone] = React.useState("UTC");
  const [prefs, setPrefs] = React.useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const res = await api.get<{ profile: Profile }>("/api/account/profile");
      if (signal?.aborted) return;
      const p = res.profile;
      setProfile(p);
      setFullName(p.fullName ?? "");
      setTimezone(p.timezone || "UTC");
      setPrefs(p.notificationPrefs ?? {});
    } catch (err) {
      if (!signal?.aborted) setLoadError(errorMessage(err));
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const dirty = React.useMemo(() => {
    if (!profile) return false;
    return (
      fullName !== (profile.fullName ?? "") ||
      timezone !== profile.timezone ||
      NOTIFICATIONS.some((n) => Boolean(prefs[n.key]) !== Boolean(profile.notificationPrefs?.[n.key]))
    );
  }, [profile, fullName, timezone, prefs]);

  async function save() {
    setSaveState("saving");
    setSaveError(null);
    setErrors({});
    try {
      const res = await api.patch<{ profile: Profile }>("/api/account/profile", {
        fullName: fullName.trim() || undefined,
        timezone,
        notificationPrefs: Object.fromEntries(NOTIFICATIONS.map((n) => [n.key, Boolean(prefs[n.key])])),
      });
      setProfile(res.profile);
      setFullName(res.profile.fullName ?? "");
      setTimezone(res.profile.timezone);
      setPrefs(res.profile.notificationPrefs ?? {});
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setSaveError(errorMessage(err));
      setErrors(fieldErrors(err));
    }
  }

  const zones = React.useMemo(
    () => typeof Intl !== "undefined" ? Intl.supportedValuesOf?.("timeZone") ?? ["UTC"] : ["UTC"],
    [],
  );

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your profile and what AfterKey emails you about. Vault contents are never included in notification emails."
      />
      {loadError && (
        <Alert tone="error" title="Could not load your profile" className="mb-4">
          {loadError}
        </Alert>
      )}
      <div className="grid gap-5">
        <Card>
          <CardHeader title="Profile" description="Used to address you and to schedule check-ins at your local time." />
          <CardBody className="space-y-4">
            <Field label="Email address" description="Confirmed addresses can invite recipients and configure releases.">
              <Input value={profile?.email ?? ""} disabled aria-label="Email address" />
            </Field>
            <Field label="Full name" error={errors.fullName} optionalHint>
              <Input
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setSaveState("unsaved");
                }}
                maxLength={120}
                placeholder="e.g. Wanjiku Kamau"
                autoComplete="name"
              />
            </Field>
            <Field
              label="Time zone"
              description="Check-in times and reminders use this zone."
              error={errors.timezone}
            >
              <Select
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  setSaveState("unsaved");
                }}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>
          </CardBody>
          <CardFooter>
            <Button onClick={save} disabled={!dirty || saveState === "saving"} loading={saveState === "saving"}>
              Save changes
            </Button>
            <SaveStatus state={saveState} error={saveError} />
          </CardFooter>
        </Card>

        <Card>
          <CardHeader
            title="Notifications"
            description="Security and release emails are strongly recommended; you can still use AfterKey without them."
          />
          <CardBody className="space-y-4">
            {NOTIFICATIONS.map((n) => (
              <Checkbox
                key={n.key}
                label={n.label}
                description={n.description}
                checked={Boolean(prefs[n.key])}
                onChange={(e) => {
                  setPrefs((p) => ({ ...p, [n.key]: e.target.checked }));
                  setSaveState("unsaved");
                }}
              />
            ))}
          </CardBody>
          <CardFooter>
            <Button onClick={save} disabled={!dirty || saveState === "saving"} loading={saveState === "saving"}>
              Save changes
            </Button>
            <SaveStatus state={saveState} error={saveError} />
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
