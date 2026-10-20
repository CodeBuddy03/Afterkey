"use client";

import * as React from "react";
import { api, errorMessage } from "@/lib/api/client";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, Badge, ErrorState, LoadingState } from "@/components/ui/feedback";

interface SystemInfo {
  queue: { queued: number; scheduled: number; running: number; doneRecent: number; failed: number; dead: number; oldestQueuedAgeSeconds: number | null };
  heartbeat: { at: string | null; worker: string | null; fresh: boolean };
  deadJobs: Array<{ type: string; count: number }>;
  migrations: Array<{ version: string; appliedAt: string }>;
  clockOffsetMs: number | null;
  storage: { driver: string; bucket: string | null; region: string | null };
  email: { provider: string; from: string | null };
  release: { defaultDelaySeconds: number };
  nodeEnv: string;
  testRoutesEnabled: boolean;
}

/** Admin system diagnostics: queue, worker, migrations, drivers, clock offset. */
export function AdminSystemClient() {
  const [data, setData] = React.useState<SystemInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const res = await api.get<SystemInfo>("/api/admin/system", { signal });
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
  if (!data) return <LoadingState label="Loading system diagnostics…" />;

  return (
    <>
      <PageHeader title="System" description="Runtime configuration and health. Secrets are never shown here." />
      {data.testRoutesEnabled && (
        <Alert tone="warn" className="mb-4" title="Test routes are enabled">
          AFTERKEY_ENABLE_TEST_ROUTES lets callers advance the controlled clock and run jobs inline. Production
          configuration refuses to enable this, but double-check before deploying.
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Configuration" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <Row label="Environment" value={data.nodeEnv} />
              <Row label="Storage" value={`${data.storage.driver}${data.storage.bucket ? ` · ${data.storage.bucket} (${data.storage.region})` : " · local disk"}`} />
              <Row label="Email provider" value={`${data.email.provider}${data.email.from ? ` · from ${data.email.from}` : ""}`} />
              <Row label="Default release delay" value={`${Math.round(data.release.defaultDelaySeconds / 60)} minutes`} />
              <Row label="Test routes" value={data.testRoutesEnabled ? "ENABLED" : "disabled"} />
              <Row
                label="Controlled clock offset"
                value={data.clockOffsetMs ? `${Math.round(data.clockOffsetMs / 86_400_000)} days (test only)` : "0 (real time)"}
              />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Job queue" description="Durable queue powering escalation, releases and email." />
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Row label="Queued" value={`${data.queue.queued} (${data.queue.scheduled} scheduled ahead)`} />
              <Row label="Running" value={String(data.queue.running)} />
              <Row label="Completed (recent)" value={String(data.queue.doneRecent)} />
              <Row label="Failing (retrying)" value={String(data.queue.failed)} />
              <Row
                label="Oldest overdue job age"
                value={data.queue.oldestQueuedAgeSeconds === null ? "none overdue" : `${data.queue.oldestQueuedAgeSeconds}s`}
              />
              <Row label="Worker heartbeat" value={data.heartbeat.fresh ? `fresh (${data.heartbeat.worker ?? "unknown"})` : "STALE — worker down"} />
            </dl>
            {data.deadJobs.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-1.5 text-sm font-semibold text-danger">Dead-lettered jobs</h4>
                <ul className="space-y-1 text-sm">
                  {data.deadJobs.map((j) => (
                    <li key={j.type} className="flex justify-between border-b border-line py-1">
                      <code className="font-mono text-xs">{j.type}</code>
                      <Badge tone="danger">{j.count}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Applied migrations" description="Schema versions applied to this database, in order." />
          <CardBody>
            <ol className="flex flex-wrap gap-2">
              {data.migrations.map((m) => (
                <li key={m.version} className="rounded border border-line bg-ivory-50 px-2.5 py-1 font-mono text-xs text-navy">
                  {m.version}
                  <span className="ml-1.5 text-muted">{new Date(m.appliedAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-navy">{value}</dd>
    </div>
  );
}
