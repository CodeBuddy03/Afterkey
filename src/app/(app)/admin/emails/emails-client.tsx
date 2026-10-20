"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { api, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/inputs";

interface EmailRow {
  id: string;
  toEmail: string;
  template: string;
  subject: string;
  status: string;
  provider: string | null;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  errorDetail: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, "neutral" | "success" | "warn" | "danger" | "gold"> = {
  queued: "gold",
  sending: "warn",
  sent: "success",
  failed: "danger",
  bounced: "danger",
  complained: "warn",
  canceled: "neutral",
};

/** Admin email outbox: metadata only (bodies stay in the database), retry failed sends. */
export function AdminEmailsClient() {
  const [items, setItems] = React.useState<EmailRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("");
  const [to, setTo] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (to.trim()) params.set("to", to.trim());
      const res = await api.get<{ items: EmailRow[] }>(`/api/admin/emails?${params.toString()}`, { signal });
      if (!signal?.aborted) setItems(res.items ?? []);
    } catch (err) {
      if (!signal?.aborted && !(err instanceof DOMException && err.name === "AbortError")) {
        setError(errorMessage(err));
        setItems([]);
      }
    }
  }, [status, to]);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function retry(row: EmailRow) {
    setBusyId(row.id);
    setNotice(null);
    try {
      await api.post("/api/admin/emails", { id: row.id });
      setNotice(`Requeued ${row.template} to ${row.toEmail}.`);
      await load();
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Email outbox"
        description="Every message AfterKey generated. Bodies are never shown here — this view cannot disclose vault contents."
      />
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                <option value="queued">Queued</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="bounced">Bounced</option>
              </Select>
            </Field>
            <Field label="Recipient">
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="email address" autoComplete="off" />
            </Field>
          </div>
          {notice && (
            <Alert tone="info" role="status">
              {notice}
            </Alert>
          )}
          {error && <ErrorState message={error} onRetry={() => void load()} />}
          {items === null ? (
            <LoadingState label="Loading outbox…" />
          ) : items.length === 0 ? (
            <EmptyState title="No messages match" />
          ) : (
            <ul className="divide-y divide-line">
              {items.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-navy">{m.subject}</p>
                    <p className="truncate text-xs text-muted">
                      {m.template} → {m.toEmail} · {new Date(m.createdAt).toLocaleString()} ·{" "}
                      {m.attempts}/{m.maxAttempts} attempts
                      {m.errorCode && ` · ${m.errorCode}`}
                      {m.provider && ` · via ${m.provider}`}
                    </p>
                    {m.errorDetail && <p className="truncate text-xs text-danger">{m.errorDetail}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
                    {["failed", "bounced"].includes(m.status) && (
                      <Button size="sm" variant="secondary" loading={busyId === m.id} onClick={() => void retry(m)}>
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        Retry
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
