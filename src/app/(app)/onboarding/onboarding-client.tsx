"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarClock, Check, FileText, KeyRound, Mail, Users } from "lucide-react";
import { api, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, Badge, SaveStatus, type SaveState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/inputs";
import { cn } from "@/lib/ui/cn";

interface OnboardingData {
  counts: Record<string, number>;
  schedule: { frequency: string; timezone: string; localTime: string } | null;
  onboarding: {
    steps: { key: string; label: string; done: boolean }[];
    completed: number;
    total: number;
  };
}

const STEP_META: Record<string, { icon: React.ComponentType<{ className?: string }>; blurb: string; href?: string }> = {
  profile: { icon: Mail, blurb: "We send a confirmation link to prove we can reach you before anything else happens." },
  records: { icon: KeyRound, blurb: "Add one bank account or online service so your vault is not empty when it matters.", href: "/financial" },
  documents: { icon: FileText, blurb: "Upload a will, ID scan or letter — files are encrypted before they leave your device session.", href: "/documents" },
  recipient: { icon: Users, blurb: "Invite the person who should receive your content. They only get what you grant, when you allow it.", href: "/recipients" },
  schedule: { icon: CalendarClock, blurb: "Choose how often we check in. Missed check-ins are the trigger for the whole release process." },
  recovery: { icon: KeyRound, blurb: "Two-factor plus a written recovery phrase mean you can get back in — and nobody else can.", href: "/settings/security" },
};

/** Onboarding wizard: real progress from the dashboard API, one action per step. */
export function OnboardingClient() {
  const router = useRouter();
  const [data, setData] = React.useState<OnboardingData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [resendState, setResendState] = React.useState<SaveState>("idle");
  const [resendMsg, setResendMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const res = await api.get<OnboardingData>("/api/dashboard");
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

  async function resend() {
    setResendState("saving");
    setResendMsg(null);
    try {
      await api.post("/api/auth/resend-verification");
      setResendState("saved");
      setResendMsg("Confirmation email sent. Open it on this device to finish this step.");
    } catch (err) {
      setResendState("error");
      setResendMsg(errorMessage(err));
    }
  }

  const pct = data ? Math.round((data.onboarding.completed / Math.max(1, data.onboarding.total)) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-navy">Set up your vault</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
          Six steps, about ten minutes. Each one unlocks a part of AfterKey — you can leave and come back at any time.
        </p>
      </header>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {data && (
        <>
          <div className="mb-6 rounded-card border border-line bg-surface p-4 shadow-card">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-navy">
                {data.onboarding.completed} of {data.onboarding.total} complete
              </span>
              <span className="text-muted">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ivory-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-navy transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <ol className="grid gap-4">
            {data.onboarding.steps.map((step, i) => {
              const meta = STEP_META[step.key] ?? { icon: Check, blurb: "", href: undefined };
              const Icon = meta.icon;
              return (
                <li key={step.key}>
                  <Card className={cn(step.done && "border-confirmed-50")}>
                    <CardBody className="flex items-start gap-4 py-4">
                      <span
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                          step.done ? "border-confirmed-50 bg-confirmed-50 text-confirmed" : "border-line-dark bg-surface text-navy",
                        )}
                        aria-hidden="true"
                      >
                        {step.done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold text-navy">
                            {i + 1}. {step.label}
                          </h2>
                          {step.done ? <Badge tone="success">Done</Badge> : <Badge tone="gold">To do</Badge>}
                        </div>
                        <p className="mt-1 text-sm leading-6 text-muted">{meta.blurb}</p>
                        <StepAction
                          stepKey={step.key}
                          done={step.done}
                          href={meta.href}
                          schedule={data.schedule}
                          onResend={resend}
                          resendState={resendState}
                          resendMsg={resendMsg}
                          onChanged={() => void load()}
                        />
                      </div>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ol>

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={() => router.push("/dashboard")} size="lg">
              Go to dashboard
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            {data.onboarding.completed === data.onboarding.total && (
              <span className="text-sm font-medium text-confirmed">All set — your vault is ready.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StepAction({
  stepKey,
  done,
  href,
  schedule,
  onResend,
  resendState,
  resendMsg,
  onChanged,
}: {
  stepKey: string;
  done: boolean;
  href?: string;
  schedule: OnboardingData["schedule"];
  onResend: () => void;
  resendState: SaveState;
  resendMsg: string | null;
  onChanged: () => void;
}) {
  if (done) return null;

  if (stepKey === "profile") {
    return (
      <div className="mt-3">
        <Button variant="secondary" size="sm" onClick={onResend} loading={resendState === "saving"}>
          Send confirmation email again
        </Button>
        {resendMsg && (
          <p className={cn("mt-2 text-xs font-medium", resendState === "error" ? "text-danger" : "text-confirmed")}>
            {resendMsg}
          </p>
        )}
      </div>
    );
  }

  if (stepKey === "schedule") {
    return <ScheduleQuickSetup schedule={schedule} onSaved={onChanged} />;
  }

  if (href) {
    return (
      <div className="mt-3">
        <Link href={href} data-interactive className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy underline decoration-champagne underline-offset-4">
          Open now
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return null;
}

function ScheduleQuickSetup({
  schedule,
  onSaved,
}: {
  schedule: OnboardingData["schedule"];
  onSaved: () => void;
}) {
  const [frequency, setFrequency] = React.useState(schedule?.frequency ?? "monthly");
  const [localTime, setLocalTime] = React.useState(schedule?.localTime ?? "09:00");
  const [timezone, setTimezone] = React.useState(schedule?.timezone ?? "UTC");
  const [state, setState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (schedule) {
      setFrequency(schedule.frequency);
      setLocalTime(schedule.localTime);
      setTimezone(schedule.timezone);
    }
  }, [schedule]);

  const zones = React.useMemo(
    () => (typeof Intl !== "undefined" ? Intl.supportedValuesOf?.("timeZone") ?? ["UTC"] : ["UTC"]),
    [],
  );

  async function save() {
    setState("saving");
    setError(null);
    try {
      await api.patch("/api/checkins", { frequency, localTime, timezone });
      setState("saved");
      onSaved();
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    }
  }

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <Field label="How often">
        <Select value={frequency} onChange={(e) => { setFrequency(e.target.value); setState("unsaved"); }}>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Every 3 months</option>
        </Select>
      </Field>
      <Field label="At (your time)">
        <Input type="time" value={localTime} onChange={(e) => { setLocalTime(e.target.value); setState("unsaved"); }} />
      </Field>
      <Field label="Time zone">
        <Select value={timezone} onChange={(e) => { setTimezone(e.target.value); setState("unsaved"); }}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button size="sm" onClick={save} loading={state === "saving"}>
          Save schedule
        </Button>
        <SaveStatus state={state} error={error} />
      </div>
    </div>
  );
}
