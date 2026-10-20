"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, History, ShieldCheck } from "lucide-react";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button, Spinner } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader, StatBlock } from "@/components/ui/card";
import { Alert, Badge, SaveStatus, type SaveState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/inputs";

interface Schedule {
  id: string;
  frequency: string;
  localTime: string;
  timezone: string;
  anchorDate: string;
  graceHours: number;
  status: string;
  currentState: string;
  nextDueAt: string;
  lastCheckinAt: string | null;
  reminders: string[];
}

interface Policy {
  id: string;
  enabled: boolean;
  verificationMethod: string;
  trustedContactThreshold: number;
  delaySeconds: number;
  categories: string[];
  overdueNoticeHours: number;
  version: number;
}

interface HistoryEntry {
  id: number;
  type: string;
  details: Record<string, unknown>;
  actorType: string;
  occurredAt: string;
}

interface ActiveCase {
  id: string;
  state: string;
  openedAt: string;
  verificationDeadlineAt: string | null;
  releaseAt: string | null;
}

interface CheckinsData {
  schedule: Schedule;
  policy: Policy;
  history: HistoryEntry[];
  activeCase: ActiveCase | null;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CheckinsClient() {
  const [data, setData] = React.useState<CheckinsData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [message, setMessage] = useStateMessage();

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const res = await api.get<CheckinsData>("/api/checkins");
      if (!signal?.aborted) setData(res);
    } catch (err) {
      if (!signal?.aborted) setError(errorMessage(err));
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function confirm() {
    setConfirming(true);
    try {
      const res = await api.post<{ message: string; canceledReleaseCaseId: string | null }>(
        "/api/checkins",
        {},
      );
      setMessage(res);
      await load();
    } catch (err) {
      setMessage({ message: errorMessage(err), canceledReleaseCaseId: null, error: true });
    } finally {
      setConfirming(false);
    }
  }

  const overdue =
    data &&
    ["overdue", "grace_period", "verification_pending", "release_scheduled", "incident"].includes(
      data.schedule.currentState,
    );

  return (
    <>
      <PageHeader
        title="Check-ins & release"
        description="Your check-in schedule drives everything: missed check-ins start reminders, escalation, verification and — only if all your conditions hold — a release. Signing in and confirming you're OK stops any pending case instantly."
        actions={
          <Button onClick={() => void confirm()} loading={confirming} size="lg">
            <CheckCircle2 size={17} aria-hidden="true" />
            I&apos;m OK — confirm check-in
          </Button>
        }
      />

      {message && (
        <div className="mb-5">
          <Alert tone={message.error ? "error" : "success"} title={message.error ? "Couldn't confirm" : "Confirmed"}>
            {message.message}
          </Alert>
        </div>
      )}

      {error && (
        <div className="mb-5">
          <Alert tone="error" title="Couldn't load your schedule">
            {error}
          </Alert>
        </div>
      )}

      {data?.activeCase && (
        <div className="mb-5">
          <Card className="border-danger-50">
            <CardBody>
              <div className="flex gap-3">
                <CircleAlert size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-danger-700">
                    Release case open — {data.activeCase.state.replace(/_/g, " ")}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    Opened {fmt(data.activeCase.openedAt)}
                    {data.activeCase.verificationDeadlineAt &&
                      ` · verification deadline ${fmt(data.activeCase.verificationDeadlineAt)}`}
                    {data.activeCase.releaseAt && ` · release scheduled ${fmt(data.activeCase.releaseAt)}`}.
                  </p>
                  <p className="mt-2 text-sm font-medium text-charcoal">
                    Press “I&apos;m OK” above to cancel it now. Cancellation is immediate and
                    permanent — a cancelled case can never disclose content afterwards.
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {!data ? (
          <>
            <div className="h-24 animate-pulse rounded-card bg-surface" />
            <div className="h-24 animate-pulse rounded-card bg-surface" />
            <div className="h-24 animate-pulse rounded-card bg-surface" />
            <div className="h-24 animate-pulse rounded-card bg-surface" />
          </>
        ) : (
          <>
            <StatBlock
              label="Next check-in due"
              value={fmt(data.schedule.nextDueAt)}
              hint={`${data.schedule.frequency} at ${data.schedule.localTime} (${data.schedule.timezone})`}
              tone={overdue ? "danger" : "neutral"}
            />
            <StatBlock
              label="Current state"
              value={data.schedule.currentState.replace(/_/g, " ")}
              hint={`Status: ${data.schedule.status}`}
              tone={overdue ? "warn" : "success"}
            />
            <StatBlock
              label="Last confirmed"
              value={data.schedule.lastCheckinAt ? fmt(data.schedule.lastCheckinAt) : "Never"}
              hint={`Grace period: ${data.schedule.graceHours}h after due`}
            />
            <StatBlock
              label="Release protection"
              value={data.policy.enabled ? "Enabled" : "Off"}
              hint={`Policy v${data.policy.version}`}
              tone={data.policy.enabled ? "success" : "warn"}
            />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ScheduleSettings
          schedule={data?.schedule ?? null}
          onSaved={() => void load()}
        />
        <PolicySettings policy={data?.policy ?? null} onSaved={() => void load()} />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="History"
          description="Every check-in, reminder, escalation and case transition, newest first."
          actions={<History size={16} className="text-muted" aria-hidden="true" />}
        />
        <CardBody>
          {!data ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
              <Spinner className="text-navy" /> Loading history…
            </div>
          ) : data.history.length === 0 ? (
            <p className="text-sm text-muted">No events yet — they'll appear after your first reminder or check-in.</p>
          ) : (
            <ol className="space-y-0">
              {data.history.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2.5 last:border-0">
                  <div className="flex items-center gap-2.5">
                    <Badge tone={entry.type.includes("case") || entry.type.includes("release") ? "warn" : entry.type.includes("confirmed") ? "success" : "neutral"}>
                      {entry.type.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-muted">by {entry.actorType}</span>
                  </div>
                  <span className="text-xs text-muted">{fmt(entry.occurredAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function useStateMessage(): [
  { message: string; canceledReleaseCaseId: string | null; error?: boolean } | null,
  (v: { message: string; canceledReleaseCaseId: string | null; error?: boolean } | null) => void,
] {
  const [state, setState] = React.useState<{
    message: string;
    canceledReleaseCaseId: string | null;
    error?: boolean;
  } | null>(null);
  return [state, setState];
}

function ScheduleSettings({
  schedule,
  onSaved,
}: {
  schedule: Schedule | null;
  onSaved: () => void;
}) {
  const [values, setValues] = React.useState({
    frequency: schedule?.frequency ?? "monthly",
    localTime: schedule?.localTime ?? "09:00",
    timezone: schedule?.timezone ?? "Africa/Nairobi",
    graceHours: String(schedule?.graceHours ?? 72),
    status: schedule?.status ?? "active",
    reminders: schedule?.reminders ?? ["d4", "d1", "due"],
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [state, setState] = React.useState<SaveState>("idle");
  const [saving, setSaving] = React.useState(false);

  // Hydrate when the server data arrives/changes.
  React.useEffect(() => {
    if (!schedule) return;
    setValues({
      frequency: schedule.frequency,
      localTime: schedule.localTime,
      timezone: schedule.timezone,
      graceHours: String(schedule.graceHours),
      status: schedule.status,
      reminders: schedule.reminders ?? ["d4", "d1", "due"],
    });
  }, [schedule]);

  function upd(key: keyof typeof values) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setValues((v) => ({ ...v, [key]: e.target.value }));
      setState("unsaved");
    };
  }

  function toggleReminder(value: string, checked: boolean) {
    setValues((v) => ({
      ...v,
      reminders: checked ? [...v.reminders, value] : v.reminders.filter((r) => r !== value),
    }));
    setState("unsaved");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const local: Record<string, string> = {};
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(values.localTime))
      local.localTime = "Use a 24-hour time such as 09:00.";
    const grace = Number(values.graceHours);
    if (!Number.isInteger(grace) || grace < 0 || grace > 720)
      local.graceHours = "Grace must be 0–720 hours.";
    setErrors(local);
    if (Object.keys(local).length) return;

    setSaving(true);
    setState("saving");
    try {
      await api.patch("/api/checkins", {
        frequency: values.frequency,
        localTime: values.localTime,
        timezone: values.timezone,
        graceHours: grace,
        status: values.status,
        reminders: values.reminders,
      });
      setState("saved");
      onSaved();
    } catch (err) {
      setSaving(false);
      setState("error");
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Schedule settings"
        description="When and how often you're asked to confirm you're OK."
      />
      <CardBody>
        <form onSubmit={save} noValidate className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Frequency" required>
              <Select value={values.frequency} onChange={upd("frequency")}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </Select>
            </Field>

            <Field label="Local time" description="Checked in your timezone." required error={errors.localTime}>
              <Input
                type="time"
                value={values.localTime}
                onChange={upd("localTime")}
                invalid={Boolean(errors.localTime)}
              />
            </Field>

            <Field label="Timezone" required>
              <Input value={values.timezone} onChange={upd("timezone")} placeholder="Africa/Nairobi" />
            </Field>

            <Field
              label="Grace period (hours)"
              description="After the due time before escalation begins."
              required
              error={errors.graceHours}
            >
              <Input
                type="number"
                min={0}
                max={720}
                value={values.graceHours}
                onChange={upd("graceHours")}
                invalid={Boolean(errors.graceHours)}
              />
            </Field>

            <Field label="Status">
              <Select value={values.status} onChange={upd("status")}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="vacation">On vacation</option>
                <option value="disabled">Disabled</option>
              </Select>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-charcoal">Reminder emails</legend>
            <p className="mb-2.5 text-xs leading-5 text-muted">
              Sent before the due date so a missed check-in is never a surprise.
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2.5">
              {[
                { value: "d4", label: "4 days before" },
                { value: "d1", label: "1 day before" },
                { value: "due", label: "On the due day" },
                { value: "post1", label: "1 day after (overdue)" },
              ].map((r) => (
                <label key={r.value} className="flex items-center gap-2 text-sm text-charcoal">
                  <input
                    type="checkbox"
                    data-interactive
                    checked={values.reminders.includes(r.value)}
                    onChange={(e) => toggleReminder(r.value, e.target.checked)}
                    className="h-4 w-4 rounded border-line-dark accent-navy"
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <SaveStatus state={state} />
            <Button type="submit" loading={saving}>
              Save schedule
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function PolicySettings({ policy, onSaved }: { policy: Policy | null; onSaved: () => void }) {
  const [values, setValues] = React.useState({
    enabled: policy?.enabled ?? false,
    verificationMethod: policy?.verificationMethod ?? "trusted_contacts",
    trustedContactThreshold: String(policy?.trustedContactThreshold ?? 1),
    delaySeconds: String(policy?.delaySeconds ?? 7200),
    categories: policy?.categories ?? ["financial", "digital", "documents", "properties", "messages"],
    overdueNoticeHours: String(policy?.overdueNoticeHours ?? 1),
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [state, setState] = React.useState<SaveState>("idle");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!policy) return;
    setValues({
      enabled: policy.enabled,
      verificationMethod: policy.verificationMethod,
      trustedContactThreshold: String(policy.trustedContactThreshold),
      delaySeconds: String(policy.delaySeconds),
      categories: policy.categories ?? [],
      overdueNoticeHours: String(policy.overdueNoticeHours),
    });
  }, [policy]);

  function toggleCategory(value: string, checked: boolean) {
    setValues((v) => ({
      ...v,
      categories: checked ? [...v.categories, value] : v.categories.filter((c) => c !== value),
    }));
    setState("unsaved");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const local: Record<string, string> = {};
    if (!values.categories.length)
      local.categories = "Choose at least one category to release — or disable release below.";
    const delay = Number(values.delaySeconds);
    if (!Number.isInteger(delay) || delay < 0 || delay > 604800)
      local.delaySeconds = "Delay must be 0–604800 seconds (7 days).";
    setErrors(local);
    if (Object.keys(local).length && values.enabled) return;

    setSaving(true);
    setState("saving");
    try {
      await api.put("/api/checkins", {
        enabled: values.enabled,
        verificationMethod: values.verificationMethod,
        trustedContactThreshold: Number(values.trustedContactThreshold),
        delaySeconds: delay,
        categories: values.categories,
        overdueNoticeHours: Number(values.overdueNoticeHours),
      });
      setState("saved");
      onSaved();
    } catch (err) {
      setSaving(false);
      setState("error");
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  }

  const anyOtherOpen = policy?.enabled === false;

  return (
    <Card>
      <CardHeader
        title="Release conditions"
        description="What has to be true before any content is shared with anyone."
        actions={
          <Badge tone={policy?.enabled ? "danger" : "success"}>
            {policy?.enabled ? "armed" : "off"}
          </Badge>
        }
      />
      <CardBody>
        <form onSubmit={save} noValidate className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}

          <Alert tone="warn" title="Read this before enabling">
            While release is enabled, missed check-ins within your grace period will open a case,
            run verification, and disclose the categories below to your recipients — unless you
            sign in and confirm you&apos;re OK first. You can turn this off at any time.
          </Alert>

          <label className="flex items-start gap-2.5 rounded-lg border border-line bg-ivory-100/60 p-3.5">
            <input
              type="checkbox"
              data-interactive
              checked={values.enabled}
              onChange={(e) => {
                setValues((v) => ({ ...v, enabled: e.target.checked }));
                setState("unsaved");
              }}
              className="mt-0.5 h-4 w-4 rounded border-line-dark accent-navy"
            />
            <span>
              <span className="block text-sm font-semibold text-navy">
                Enable conditional release
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted">
                Off means missed check-ins only ever send you reminders — nothing is disclosed.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Verification method" description="How release is confirmed before disclosure.">
              <Select
                value={values.verificationMethod}
                onChange={(e) => {
                  setValues((v) => ({ ...v, verificationMethod: e.target.value }));
                  setState("unsaved");
                }}
                disabled={!values.enabled}
              >
                <option value="trusted_contacts">Trusted contacts attest</option>
                <option value="email_otp">One-time code to you</option>
                <option value="evidence_review">Evidence review by admin</option>
              </Select>
            </Field>

            <Field
              label="Trusted contacts required"
              description="How many recipients must attest before release proceeds."
              error={errors.trustedContactThreshold}
            >
              <Input
                type="number"
                min={1}
                max={10}
                value={values.trustedContactThreshold}
                disabled={!values.enabled || values.verificationMethod !== "trusted_contacts"}
                onChange={(e) => {
                  setValues((v) => ({ ...v, trustedContactThreshold: e.target.value }));
                  setState("unsaved");
                }}
              />
            </Field>

            <Field
              label="Delay before release (seconds)"
              description="Cooling-off window after verification — during which you can still cancel by signing in."
              error={errors.delaySeconds}
            >
              <Input
                type="number"
                min={0}
                max={604800}
                value={values.delaySeconds}
                disabled={!values.enabled}
                onChange={(e) => {
                  setValues((v) => ({ ...v, delaySeconds: e.target.value }));
                  setState("unsaved");
                }}
                invalid={Boolean(errors.delaySeconds)}
              />
            </Field>

            <Field label="Overdue notice (hours)" description="How long before escalating to recipients.">
              <Input
                type="number"
                min={0}
                max={720}
                value={values.overdueNoticeHours}
                disabled={!values.enabled}
                onChange={(e) => {
                  setValues((v) => ({ ...v, overdueNoticeHours: e.target.value }));
                  setState("unsaved");
                }}
              />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-charcoal">
              Categories that may be released
            </legend>
            <div className="space-y-2.5">
              {[
                { value: "financial", label: "Financial records" },
                { value: "digital", label: "Digital accounts" },
                { value: "documents", label: "Documents" },
                { value: "properties", label: "Properties" },
                { value: "messages", label: "Legacy messages" },
              ].map((cat) => (
                <label key={cat.value} className="flex items-center gap-2.5 text-sm text-charcoal">
                  <input
                    type="checkbox"
                    data-interactive
                    checked={values.categories.includes(cat.value)}
                    disabled={!values.enabled}
                    onChange={(e) => toggleCategory(cat.value, e.target.checked)}
                    className="h-4 w-4 rounded border-line-dark accent-navy"
                  />
                  {cat.label}
                </label>
              ))}
            </div>
            {errors.categories && (
              <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
                {errors.categories}
              </p>
            )}
          </fieldset>

          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <SaveStatus state={state} />
            <Button type="submit" loading={saving} variant={values.enabled ? "danger" : "primary"}>
              {anyOtherOpen ? "Enable release conditions" : "Save release conditions"}
            </Button>
          </div>

          <p className="flex items-start gap-2 text-xs leading-5 text-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            Verification and release are enforced by the backend state machine. The interface never
            decides on its own — and a cancelled case can never disclose content, regardless of any
            queued job.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
