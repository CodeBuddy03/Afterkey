"use client";

import * as React from "react";
import { api, errorMessage } from "@/lib/api/client";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/inputs";

interface SupportRow {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
}

const STATUS_TONE: Record<string, "neutral" | "gold" | "success" | "warn"> = {
  new: "gold",
  open: "warn",
  resolved: "success",
  closed: "neutral",
};

/** Admin support inbox: contact-form submissions with status transitions. */
export function AdminSupportClient() {
  const [items, setItems] = React.useState<SupportRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const qs = status ? `?status=${status}` : "";
      const res = await api.get<{ items: SupportRow[] }>(`/api/admin/support${qs}`, { signal });
      if (!signal?.aborted) setItems(res.items ?? []);
    } catch (err) {
      if (!signal?.aborted && !(err instanceof DOMException && err.name === "AbortError")) {
        setError(errorMessage(err));
        setItems([]);
      }
    }
  }, [status]);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function update(id: string, next: SupportRow["status"]) {
    setBusyId(id);
    setNotice(null);
    try {
      await api.patch("/api/admin/support", { id, status: next });
      await load();
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title="Support inbox" description="Messages from the public contact form." />
      <div className="mb-4 max-w-xs">
        <Field label="Filter">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="new">New</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </Select>
        </Field>
      </div>
      {notice && (
        <Alert tone="info" role="status" className="mb-4">
          {notice}
        </Alert>
      )}
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {items === null ? (
        <LoadingState label="Loading inbox…" />
      ) : items.length === 0 ? (
        <EmptyState title="No support requests" description="The inbox is clear." />
      ) : (
        <div className="grid gap-4">
          {items.map((r) => (
            <Card key={r.id}>
              <CardBody className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-navy">{r.subject}</p>
                  <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                </div>
                <p className="text-xs text-muted">
                  {r.name} · {r.email} · {new Date(r.createdAt).toLocaleString()}
                </p>
                <p className="whitespace-pre-line text-sm leading-6 text-charcoal">{r.message}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {(["open", "resolved", "closed"] as const).map((s) =>
                    r.status === s ? null : (
                      <button
                        key={s}
                        type="button"
                        data-interactive
                        disabled={busyId === r.id}
                        onClick={() => void update(r.id, s)}
                        className="text-xs font-semibold text-navy underline decoration-champagne underline-offset-4 disabled:opacity-60"
                      >
                        Mark {s}
                      </button>
                    ),
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
