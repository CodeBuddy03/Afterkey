"use client";

import * as React from "react";
import { api, errorMessage } from "@/lib/api/client";
import { Card, CardBody, CardHeader, PageHeader, StatBlock } from "@/components/ui/card";
import { Alert, Badge, ErrorState, LoadingState } from "@/components/ui/feedback";

interface Overview {
  counts: Record<string, number>;
  queue: {
    queued: number;
    scheduled: number;
    running: number;
    doneRecent: number;
    failed: number;
    dead: number;
    oldestQueuedAgeSeconds: number | null;
  };
  heartbeat: { at: string | null; worker: string | null; fresh: boolean };
}

/** Admin overview: account/case/email counters plus queue and worker health. */
export function AdminOverviewClient() {
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const res = await api.get<Overview>("/api/admin/overview", { signal });
      if (!signal?.aborted) setData(res);
    } catch (err) {
      if (!signal?.aborted && !(err instanceof DOMException && err.name === "AbortError")) {
        setError(errorMessage(err));
      }
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <LoadingState label="Loading operator overview…" />;

  const c = data.counts;
  return (
    <>
      <PageHeader title="Operations overview" description="Live counts across accounts, releases, email and support." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Users" value={c.users ?? 0} hint={`${c.usersUnverified ?? 0} unverified · ${c.usersSuspended ?? 0} suspended`} />
        <StatBlock label="Vaults" value={c.vaults ?? 0} hint={`${c.recipientsActive ?? 0} active recipients`} />
        <StatBlock
          label="Open release cases"
          value={c.casesOpen ?? 0}
          hint={`${c.casesReleased ?? 0} released · ${c.deliveriesAvailable ?? 0} deliveries awaiting view`}
          tone={(c.casesOpen ?? 0) > 0 ? "warn" : "neutral"}
        />
        <StatBlock
          label="Email backlog"
          value={c.emailsQueued ?? 0}
          hint={`${c.emailsFailed ?? 0} failed`}
          tone={(c.emailsFailed ?? 0) > 0 ? "danger" : "neutral"}
        />
        <StatBlock label="Support inbox" value={c.supportNew ?? 0} hint="new or open requests" tone={(c.supportNew ?? 0) > 0 ? "warn" : "neutral"} />
        <StatBlock label="Exports pending" value={c.exportsPending ?? 0} />
        <StatBlock label="Deletions scheduled" value={c.deletionsPending ?? 0} hint="executed after the grace period" />
        <StatBlock label="Dead-lettered jobs" value={data.queue.dead} tone={data.queue.dead > 0 ? "danger" : "neutral"} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Job queue" description="Durable Postgres queue: check-ins, releases, email and deletions." />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted">Queued</dt><dd className="font-semibold text-navy">{data.queue.queued}</dd></div>
              <div><dt className="text-muted">Scheduled ahead</dt><dd className="font-semibold text-navy">{data.queue.scheduled}</dd></div>
              <div><dt className="text-muted">Running</dt><dd className="font-semibold text-navy">{data.queue.running}</dd></div>
              <div><dt className="text-muted">Completed (recent)</dt><dd className="font-semibold text-navy">{data.queue.doneRecent}</dd></div>
              <div><dt className="text-muted">Failing (will retry)</dt><dd className="font-semibold text-navy">{data.queue.failed}</dd></div>
              <div className="col-span-2">
                <dt className="text-muted">Oldest overdue job age</dt>
                <dd className="font-semibold text-navy">
                  {data.queue.oldestQueuedAgeSeconds === null
                    ? "None overdue"
                    : data.queue.oldestQueuedAgeSeconds > 300
                      ? `${Math.round(data.queue.oldestQueuedAgeSeconds / 60)} min — worker may be down`
                      : `${data.queue.oldestQueuedAgeSeconds}s`}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Background worker" description="The process that executes check-in escalation and releases." />
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2">
              {data.heartbeat.fresh ? (
                <Badge tone="success">Healthy</Badge>
              ) : (
                <Badge tone="danger">No recent heartbeat</Badge>
              )}
              {data.heartbeat.worker && <span className="text-sm text-muted">{data.heartbeat.worker}</span>}
            </div>
            <p className="text-sm text-muted">
              Last heartbeat: {data.heartbeat.at ? new Date(data.heartbeat.at).toLocaleString() : "never"}. Without a
              live worker, escalation and releases do not run — check-ins still record, but nothing executes.
            </p>
            {!data.heartbeat.fresh && (
              <Alert tone="warn">
                Start the worker with <code className="font-mono">npm run worker</code> on the server.
              </Alert>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
