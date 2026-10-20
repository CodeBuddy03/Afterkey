"use client";

import * as React from "react";
import { Ban, CheckCircle2, XCircle } from "lucide-react";
import { api, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/inputs";

interface VerificationRecord {
  id: string;
  method: string;
  status: string;
  evidenceDocumentId: string | null;
  reviewNote: string | null;
  attestations: unknown;
  expiresAt: string | null;
}

interface DeliveryRow {
  id: string;
  recipientId: string;
  status: string;
  itemCount: number;
  availableAt: string | null;
}

interface ReleaseCase {
  id: string;
  state: string;
  openedAt: string;
  verificationDeadlineAt: string | null;
  releaseAt: string | null;
  releasedAt: string | null;
  failureReason: string | null;
  canceledReason: string | null;
  version: number;
  ownerEmail: string;
  ownerName: string | null;
  timezone: string;
  frequency: string;
  verificationMethod: string | null;
  delaySeconds: number | null;
  verificationRecords: VerificationRecord[];
  deliveries: DeliveryRow[];
}

const STATE_TONE: Record<string, "neutral" | "gold" | "success" | "warn" | "danger" | "navy"> = {
  verification_pending: "gold",
  release_scheduled: "warn",
  held: "navy",
  released: "success",
  canceled: "neutral",
  failed: "danger",
};

/** Admin release operations: inspect cases, cancel, and decide evidence. */
export function AdminReleasesClient() {
  const [items, setItems] = React.useState<ReleaseCase[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [state, setState] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<ReleaseCase | null>(null);
  const [reviewTarget, setReviewTarget] = React.useState<{ caseItem: ReleaseCase; record: VerificationRecord } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const qs = state ? `?state=${state}` : "";
      const res = await api.get<{ items: ReleaseCase[] }>(`/api/admin/releases${qs}`, { signal });
      if (!signal?.aborted) setItems(res.items ?? []);
    } catch (err) {
      if (!signal?.aborted && !(err instanceof DOMException && err.name === "AbortError")) {
        setError(errorMessage(err));
        setItems([]);
      }
    }
  }, [state]);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function cancel(caseItem: ReleaseCase, note: string) {
    setBusy(true);
    try {
      await api.post("/api/admin/releases", { caseId: caseItem.id, action: "cancel", note });
      setNotice(`Case cancelled; queued execution jobs invalidated.`);
      setCancelTarget(null);
      await load();
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function review(recordId: string, decision: "approve" | "reject", note: string) {
    if (!reviewTarget) return;
    setBusy(true);
    try {
      const res = await api.post<{ scheduled: boolean }>("/api/admin/releases", {
        caseId: reviewTarget.caseItem.id,
        action: "review_evidence",
        recordId,
        decision,
        note,
      });
      setNotice(
        decision === "approve"
          ? res.scheduled
            ? "Evidence approved — release scheduled with the configured delay."
            : "Evidence approved."
          : "Evidence rejected — the release stays blocked.",
      );
      setReviewTarget(null);
      await load();
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Release cases"
        description="Every escalation and its verification trail. Administrators can stop a release or decide evidence — they can never open one or read vault contents."
      />
      <div className="mb-4 max-w-xs">
        <Field label="Filter by state">
          <Select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All states</option>
            <option value="verification_pending">Verification pending</option>
            <option value="release_scheduled">Release scheduled</option>
            <option value="released">Released</option>
            <option value="canceled">Canceled</option>
            <option value="failed">Failed / blocked</option>
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
        <LoadingState label="Loading cases…" />
      ) : items.length === 0 ? (
        <EmptyState title="No release cases" description="Cases appear here when a user misses check-ins with release enabled." />
      ) : (
        <div className="grid gap-4">
          {items.map((c) => (
            <Card key={c.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {c.ownerName ?? c.ownerEmail}
                    <Badge tone={STATE_TONE[c.state] ?? "neutral"}>{c.state.replace("_", " ")}</Badge>
                  </span>
                }
                description={`${c.ownerEmail} · ${c.frequency} check-ins (${c.timezone}) · opened ${new Date(c.openedAt).toLocaleString()}`}
                actions={
                  ["verification_pending", "release_scheduled", "held"].includes(c.state) ? (
                    <Button size="sm" variant="danger" onClick={() => setCancelTarget(c)}>
                      <Ban className="h-4 w-4" aria-hidden="true" />
                      Cancel release
                    </Button>
                  ) : null
                }
              />
              <CardBody className="space-y-3 text-sm">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <span className="text-muted">Method</span>
                    <p className="font-medium text-navy">
                      {c.verificationMethod ?? "—"}
                      {c.delaySeconds !== null && ` · ${Math.round(c.delaySeconds / 60)} min delay`}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted">Verification deadline</span>
                    <p className="font-medium text-navy">
                      {c.verificationDeadlineAt ? new Date(c.verificationDeadlineAt).toLocaleString() : "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted">Release / outcome</span>
                    <p className="font-medium text-navy">
                      {c.releaseAt
                        ? `${new Date(c.releaseAt).toLocaleString()}${c.releasedAt ? " · executed" : ""}`
                        : c.state === "canceled"
                          ? `cancelled (${c.canceledReason ?? "—"})`
                          : c.state === "failed"
                            ? (c.failureReason ?? "blocked")
                            : "—"}
                    </p>
                  </div>
                </div>

                {c.verificationRecords.length > 0 && (
                  <div>
                    <h4 className="mb-1.5 font-medium text-navy">Verification records</h4>
                    <ul className="space-y-1.5">
                      {c.verificationRecords.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line px-3 py-2">
                          <span>
                            {r.method} · <span className="text-muted">{r.status}</span>
                            {r.reviewNote && <span className="text-muted"> — “{r.reviewNote}”</span>}
                          </span>
                          {r.method === "evidence_review" && r.status === "pending" && (
                            <span className="flex gap-2">
                              <Button size="sm" variant="secondary" onClick={() => setReviewTarget({ caseItem: c, record: r })}>
                                Review evidence
                              </Button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {c.deliveries.length > 0 && (
                  <div>
                    <h4 className="mb-1.5 font-medium text-navy">Deliveries</h4>
                    <ul className="space-y-1">
                      {c.deliveries.map((d) => (
                        <li key={d.id} className="text-muted">
                          recipient {d.recipientId.slice(0, 8)}… · {d.itemCount} item(s) · {d.status}
                          {d.availableAt && ` · available since ${new Date(d.availableAt).toLocaleString()}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <CancelDialog target={cancelTarget} busy={busy} onClose={() => setCancelTarget(null)} onConfirm={(note) => cancelTarget && void cancel(cancelTarget, note)} />
      <ReviewDialog
        target={reviewTarget}
        busy={busy}
        onClose={() => setReviewTarget(null)}
        onDecide={(decision, note) => reviewTarget && void review(reviewTarget.record.id, decision, note)}
      />
    </>
  );
}

function CancelDialog({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target: ReleaseCase | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (target) setNote("");
  }, [target]);
  return (
    <Dialog
      open={Boolean(target)}
      onClose={onClose}
      title="Cancel this release?"
      description="The case is cancelled, its execution jobs are invalidated, and the user's schedule returns to active with a fresh due date. This cannot be undone."
    >
      <div className="space-y-4">
        <Field label="Reason" description="Recorded in the audit trail and shown to the user." optionalHint>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <div className="flex gap-3">
          <Button variant="danger" loading={busy} onClick={() => onConfirm(note)}>
            Cancel release
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ReviewDialog({
  target,
  busy,
  onClose,
  onDecide,
}: {
  target: { caseItem: ReleaseCase; record: VerificationRecord } | null;
  busy: boolean;
  onClose: () => void;
  onDecide: (decision: "approve" | "reject", note: string) => void;
}) {
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (target) setNote("");
  }, [target]);
  return (
    <Dialog
      open={Boolean(target)}
      onClose={onClose}
      title="Review documentary evidence"
      description="Approving satisfies the verification procedure and schedules the release (still cancellable during its delay). Rejecting keeps it blocked."
    >
      <div className="space-y-4">
        {target && (
          <p className="text-sm text-muted">
            Case for {target.caseItem.ownerEmail} · evidence document id {target.record.evidenceDocumentId ?? "not submitted"}
          </p>
        )}
        <Field label="Review note" description="Why you decided this. Kept in the case record." optionalHint>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <div className="flex gap-3">
          <Button loading={busy} onClick={() => onDecide("approve", note)}>
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Approve evidence
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => onDecide("reject", note)}>
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Reject
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
