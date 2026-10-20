"use client";

import * as React from "react";
import { api, errorMessage } from "@/lib/api/client";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { Badge, EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/inputs";

interface AuditRow {
  id: number;
  action: string;
  actorType: string;
  actorId: string | null;
  actorLabel: string | null;
  ip: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

/** Admin audit log: append-only trail, read-only here. */
export function AdminAuditClient() {
  const [items, setItems] = React.useState<AuditRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [action, setAction] = React.useState("");
  const [actor, setActor] = React.useState("");

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (action.trim()) params.set("action", action.trim());
      if (actor.trim()) params.set("actor", actor.trim());
      const res = await api.get<{ items: AuditRow[] }>(`/api/admin/audit?${params.toString()}`, { signal });
      if (!signal?.aborted) setItems(res.items ?? []);
    } catch (err) {
      if (!signal?.aborted && !(err instanceof DOMException && err.name === "AbortError")) {
        setError(errorMessage(err));
        setItems([]);
      }
    }
  }, [action, actor]);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Security-relevant actions across the platform. Append-only — this view cannot modify it."
      />
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Action prefix" description="e.g. release. or admin.">
              <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="release." autoComplete="off" />
            </Field>
            <Field label="Actor">
              <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="email or id" autoComplete="off" />
            </Field>
          </div>
          {error && <ErrorState message={error} onRetry={() => void load()} />}
          {items === null ? (
            <LoadingState label="Loading audit trail…" />
          ) : items.length === 0 ? (
            <EmptyState title="No events match" />
          ) : (
            <ul className="divide-y divide-line">
              {items.map((e) => (
                <li key={e.id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <code className="rounded bg-ivory-100 px-1.5 py-0.5 font-mono text-xs text-navy">{e.action}</code>
                      <Badge tone={e.actorType === "admin" ? "danger" : e.actorType === "system" ? "neutral" : "navy"}>
                        {e.actorType}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted">{new Date(e.occurredAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    {e.actorLabel ?? e.actorId ?? "—"}
                    {e.ip && ` · ${e.ip}`}
                    {e.targetType && ` · ${e.targetType} ${e.targetId?.slice(0, 8) ?? ""}`}
                  </p>
                  {e.metadata && Object.keys(e.metadata).length > 0 && (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted">{JSON.stringify(e.metadata)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
