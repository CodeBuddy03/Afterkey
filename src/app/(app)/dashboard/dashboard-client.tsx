"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  CircleAlert,
  FileText,
  KeyRound,
  Landmark,
  Mail,
  MapPin,
  Users,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, StatBlock } from "@/components/ui/card";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/feedback";

interface DashboardData {
  counts: {
    financial?: number;
    digital?: number;
    properties?: number;
    messages?: number;
    documents?: number;
    recipients?: number;
    recipientsActive?: number;
    documentsBytes?: number;
  };
  schedule: {
    id: string;
    frequency: string;
    timezone: string;
    localTime: string;
    graceHours: number;
    status: string;
    currentState: string;
    nextDueAt: string;
    lastCheckinAt: string | null;
  } | null;
  policy: { enabled: boolean; verificationMethod: string } | null;
  activeCase: {
    id: string;
    state: string;
    openedAt: string;
    releaseAt: string | null;
    verificationDeadlineAt: string | null;
  } | null;
  deliveries: {
    id: string;
    caseId: string;
    status: string;
    ownerName: string | null;
    availableAt: string | null;
    itemCount: number;
  }[];
  onboarding: {
    steps: { key: string; label: string; done: boolean }[];
    completed: number;
    total: number;
  };
  recentActivity: { action: string; occurredAt: string; actorLabel: string | null }[];
}

function formatDue(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DashboardClient({
  firstName,
  emailVerified,
}: {
  firstName: string;
  emailVerified: boolean;
}) {
  const router = useRouter();
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [checkingIn, setCheckingIn] = React.useState(false);
  const [checkinMsg, setCheckinMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const res = await api.get<DashboardData>("/api/dashboard");
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

  async function confirmCheckin() {
    setCheckingIn(true);
    setCheckinMsg(null);
    try {
      const res = await api.post<{ message: string }>("/api/checkins", {});
      setCheckinMsg(res.message);
      await load();
    } catch (err) {
      setCheckinMsg(errorMessage(err));
    } finally {
      setCheckingIn(false);
    }
  }

  const overdue =
    data?.schedule?.currentState === "overdue" ||
    data?.schedule?.currentState === "grace_period" ||
    data?.schedule?.currentState === "incident";

  const moduleLinks = [
    { href: "/financial", label: "Financial records", count: data?.counts.financial ?? 0, icon: Landmark },
    { href: "/digital", label: "Digital accounts", count: data?.counts.digital ?? 0, icon: KeyRound },
    { href: "/documents", label: "Documents", count: data?.counts.documents ?? 0, icon: FileText },
    { href: "/properties", label: "Properties", count: data?.counts.properties ?? 0, icon: MapPin },
    { href: "/messages", label: "Legacy messages", count: data?.counts.messages ?? 0, icon: Mail },
    { href: "/recipients", label: "Recipients", count: data?.counts.recipients ?? 0, icon: Users },
  ];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-navy">Good to see you, {firstName}</h1>
          <p className="mt-1 text-sm text-muted">
            Here&apos;s the state of your vault and check-in schedule.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
          <Button onClick={confirmCheckin} loading={checkingIn}>
            <CheckCircle2 size={16} aria-hidden="true" />
            I&apos;m OK — confirm check-in
          </Button>
        </div>
      </div>

      {checkinMsg && (
        <div className="mb-5">
          <Alert tone="success" title="Check-in confirmed">
            {checkinMsg}
          </Alert>
        </div>
      )}

      {error && (
        <div className="mb-5">
          <Alert tone="error" title="Couldn't load your dashboard">
            {error}
          </Alert>
        </div>
      )}

      {data?.activeCase && (
        <div className="mb-5">
          <Card className="border-danger-50">
            <CardBody>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex gap-3">
                  <CircleAlert size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-semibold text-danger-700">
                      A release case is open ({data.activeCase.state.replace("_", " ")})
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      Opened {formatDue(data.activeCase.openedAt)}
                      {data.activeCase.releaseAt &&
                        ` — scheduled release ${formatDue(data.activeCase.releaseAt)}`}.
                      Confirming you&apos;re OK cancels it immediately and permanently.
                    </p>
                  </div>
                </div>
                <Link href="/checkins">
                  <span className="inline-flex h-10 items-center rounded-lg bg-danger/15 px-4 text-sm font-semibold text-danger">
                    Review &amp; cancel
                  </span>
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {!emailVerified && (
        <div className="mb-5">
          <Alert tone="warn" title="Confirm your email address">
            You can invite recipients and configure release settings once your address is confirmed.
          </Alert>
        </div>
      )}

      {/* Check-in status */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data === null ? (
          <>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </>
        ) : (
          <>
            <StatBlock
              label="Next check-in"
              value={data.schedule ? formatDue(data.schedule.nextDueAt) : "Not set"}
              hint={
                data.schedule
                  ? `${data.schedule.frequency} at ${data.schedule.localTime} (${data.schedule.timezone})`
                  : "Create a schedule in check-in settings"
              }
              tone={overdue ? "danger" : "neutral"}
            />
            <StatBlock
              label="Schedule state"
              value={data.schedule ? data.schedule.currentState.replace("_", " ") : "—"}
              hint={
                data.schedule?.lastCheckinAt
                  ? `Last confirmed ${formatDue(data.schedule.lastCheckinAt)}`
                  : "No check-in confirmed yet"
              }
              tone={overdue ? "warn" : data.schedule?.currentState === "active" ? "success" : "neutral"}
            />
            <StatBlock
              label="Records stored"
              value={
                (data.counts.financial ?? 0) +
                (data.counts.digital ?? 0) +
                (data.counts.properties ?? 0) +
                (data.counts.messages ?? 0)
              }
              hint={`${data.counts.documents ?? 0} documents · ${Math.round(
                ((data.counts.documentsBytes ?? 0) / (1024 * 1024)) * 10,
              ) / 10} MB`}
            />
            <StatBlock
              label="Release protection"
              value={data.policy?.enabled ? "Enabled" : "Off"}
              hint={
                data.policy
                  ? `Verification: ${data.policy.verificationMethod.replace("_", " ")}`
                  : "Policy not loaded"
              }
              tone={data.policy?.enabled ? "success" : "warn"}
            />
          </>
        )}
      </div>

      {/* Onboarding */}
      {data && data.onboarding.completed < data.onboarding.total && (
        <Card className="mb-6">
          <CardHeader
            title={`Finish setting up (${data.onboarding.completed}/${data.onboarding.total})`}
            description="Each step is optional, but together they're what makes AfterKey useful in a real emergency."
          />
          <CardBody>
            <ol className="grid gap-3 sm:grid-cols-2">
              {data.onboarding.steps.map((step) => (
                <li
                  key={step.key}
                  className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${
                    step.done
                      ? "border-confirmed-50 bg-confirmed-50 text-confirmed-700"
                      : "border-line bg-surface text-charcoal"
                  }`}
                >
                  {step.done ? (
                    <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
                  ) : (
                    <span className="h-4 w-4 shrink-0 rounded-full border border-line-dark" aria-hidden="true" />
                  )}
                  <span className={step.done ? "line-through opacity-80" : ""}>{step.label}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4">
              <Link href="/onboarding">
                <span className="text-sm font-semibold text-navy underline decoration-champagne underline-offset-4">
                  Continue setup →
                </span>
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Module shortcuts */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {moduleLinks.map((mod) => (
          <Link
            key={mod.href}
            href={mod.href}
            className="group rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-navy-200"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50 text-navy">
                <mod.icon size={17} aria-hidden="true" />
              </span>
              <span className="tabular text-xl font-semibold text-navy">{mod.count}</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm font-medium text-charcoal group-hover:text-navy">{mod.label}</span>
              <ArrowRight size={15} className="text-muted group-hover:text-navy" aria-hidden="true" />
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Deliveries for this user (if they're a recipient somewhere) */}
        <Card>
          <CardHeader
            title="Content released to you"
            description="Packages shared with you by other AfterKey users."
          />
          <CardBody>
            {data && data.deliveries.length === 0 ? (
              <EmptyState
                title="Nothing released to you"
                description="If someone shares content with you after a verified release, it appears here."
              />
            ) : (
              <ul className="space-y-3">
                {data?.deliveries.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ivory-100/50 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-navy">
                        {d.ownerName ?? "Another user"} · {d.itemCount} item{d.itemCount === 1 ? "" : "s"}
                      </p>
                      <p className="text-xs text-muted">Available {formatDue(d.availableAt)}</p>
                    </div>
                    <Badge tone={d.status === "viewed" ? "success" : "gold"}>{d.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4">
              <Link href="/access" className="text-sm font-medium text-navy underline decoration-champagne underline-offset-4">
                Open shared content
              </Link>
            </div>
          </CardBody>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader
            title="Recent activity"
            description="Security-relevant events on your account."
            actions={
              <Link href="/settings/security" className="text-xs font-medium text-navy underline decoration-champagne underline-offset-4">
                Security settings
              </Link>
            }
          />
          <CardBody>
            {data && data.recentActivity.length === 0 ? (
              <p className="text-sm text-muted">No activity recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data?.recentActivity.map((event, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm text-charcoal">{event.action}</span>
                    <span className="shrink-0 text-xs text-muted">{formatDue(event.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {!data && <Skeleton className="h-32" />}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 text-center">
        <Button variant="ghost" onClick={() => router.push("/help")}>
          <CalendarCheck size={16} aria-hidden="true" />
          How check-ins protect you
        </Button>
      </div>
    </>
  );
}
