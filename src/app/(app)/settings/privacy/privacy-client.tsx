"use client";

import * as React from "react";
import { Download, Trash2 } from "lucide-react";
import { ApiClientError, api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, EmptyState, SaveStatus, type SaveState } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/inputs";

interface ExportDoc {
  id: string;
  title: string;
  filename: string;
  sizeBytes: number;
  uploadedAt: string;
}

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

/** Privacy settings: data export and account deletion (with 7-day cancellation). */
export function PrivacyClient({ deletionPending }: { deletionPending: boolean }) {
  const [exports, setExports] = React.useState<ExportDoc[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [exportState, setExportState] = React.useState<SaveState>("idle");
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [pending, setPending] = React.useState(deletionPending);
  const [cancelState, setCancelState] = React.useState<SaveState>("idle");
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = React.useState(false);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const res = await api.get<{ items: ExportDoc[] }>("/api/documents?category=export");
      if (!signal?.aborted) setExports(res.items ?? []);
    } catch (err) {
      if (!signal?.aborted) {
        setLoadError(errorMessage(err));
        setExports([]);
      }
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function runExport() {
    const res = await api.post<{ documentId: string; bytes: number }>("/api/account/export");
    // Hand the file straight to the user through the authorized download endpoint.
    window.location.href = `/api/documents/${res.documentId}/download`;
    setExportState("saved");
    await load();
  }

  async function requestExport() {
    setExportState("saving");
    setExportError(null);
    try {
      await runExport();
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "reauth_required") {
        // Exports need a fresh password check; ask and retry after confirming.
        setReauthOpen(true);
        setExportState("idle");
        return;
      }
      setExportState("error");
      setExportError(errorMessage(err));
    }
  }

  async function cancelDeletion() {
    setCancelState("saving");
    setCancelError(null);
    try {
      await api.delete("/api/account/delete");
      setPending(false);
      setCancelState("saved");
    } catch (err) {
      setCancelState("error");
      setCancelError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Privacy settings"
        description="Take your data with you, or delete your account. Exports contain everything stored in your vault, decrypted for you."
      />
      <div className="grid gap-5">
        {pending && (
          <Alert tone="error" title="Deletion scheduled">
            This account is scheduled for deletion. You can cancel it below as long as the grace period has not
            elapsed.
          </Alert>
        )}

        <Card>
          <CardHeader
            title="Export your data"
            description="Creates an encrypted-in-transit copy of your vault (records, documents, messages, recipients and history) as a downloadable file."
            actions={
              <Button onClick={requestExport} loading={exportState === "saving"} variant="secondary">
                <Download className="h-4 w-4" aria-hidden="true" />
                Export my data
              </Button>
            }
          />
          <CardBody>
            <SaveStatus state={exportState} error={exportError} className="mb-3" />
            {loadError && (
              <Alert tone="error" className="mb-3">
                {loadError}
              </Alert>
            )}
            {exports === null ? (
              <p className="text-sm text-muted">Loading your export history…</p>
            ) : exports.length === 0 ? (
              <EmptyState
                title="No exports yet"
                description="When you create an export it appears here and in your documents, and it is downloadable for 7 days."
              />
            ) : (
              <ul className="divide-y divide-line">
                {exports.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-navy">{doc.title}</p>
                      <p className="text-xs text-muted">
                        {doc.filename} · {(doc.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                        {new Date(doc.uploadedAt).toLocaleString()}
                      </p>
                    </div>
                    <a
                      href={`/api/documents/${doc.id}/download`}
                      data-interactive
                      className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-navy underline decoration-champagne underline-offset-4"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Delete your account"
            description="Deletion is scheduled with a 7-day grace period. Signing in during the grace period cancels it. After it executes, your vault, recipients and history are gone and cannot be recovered."
          />
          <CardFooter>
            {pending ? (
              <>
                <Button variant="secondary" onClick={cancelDeletion} loading={cancelState === "saving"}>
                  Cancel scheduled deletion
                </Button>
                <SaveStatus state={cancelState} error={cancelError} />
              </>
            ) : (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Schedule deletion
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>

      <DeleteDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onScheduled={() => {
          setDeleteOpen(false);
          setPending(true);
        }}
      />
      <ReauthDialog
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onConfirmed={() => {
          setReauthOpen(false);
          void runExport().catch((err) => {
            setExportState("error");
            setExportError(errorMessage(err));
          });
        }}
      />
    </>
  );
}

function ReauthDialog({ open, onClose, onConfirmed }: { open: boolean; onClose: () => void; onConfirmed: () => void }) {
  const [password, setPassword] = React.useState("");
  const [state, setState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPassword("");
      setState("idle");
      setError(null);
    }
  }, [open]);

  async function submit() {
    setState("saving");
    setError(null);
    try {
      await api.post("/api/auth/reauth", { password });
      setState("saved");
      onConfirmed();
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Confirm it is you" description="For your safety, exports need your password again.">
      <div className="space-y-4">
        <Field label="Password" required>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            onKeyDown={(e) => {
              if (e.key === "Enter" && password) void submit();
            }}
          />
        </Field>
        {state === "error" && error && (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        )}
        <div className="flex gap-3">
          <Button onClick={submit} disabled={!password} loading={state === "saving"}>
            Confirm and export
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DeleteDialog({
  open,
  onClose,
  onScheduled,
}: {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [password, setPassword] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");
  const [state, setState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (open) {
      setPassword("");
      setReason("");
      setConfirmText("");
      setState("idle");
      setError(null);
      setErrors({});
    }
  }, [open]);

  async function submit() {
    setState("saving");
    setError(null);
    setErrors({});
    try {
      await api.post("/api/account/delete", { password, reason: reason || undefined, confirmText });
      setState("saved");
      onScheduled();
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
      setErrors(fieldErrors(err));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Schedule account deletion" description="This cannot be undone after the grace period expires.">
      <div className="space-y-4">
        <Alert tone="warn">
          Everything in your vault — records, documents, messages, recipients, deliveries and history — will be
          permanently deleted. Export your data first if you want a copy.
        </Alert>
        <Field label="Confirm with your password" required error={errors.password}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label="Reason" description="Optional — helps us improve. Never shared." optionalHint error={errors.reason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <Field
          label={`Type ${CONFIRM_PHRASE} to confirm`}
          required
          error={errors.confirmText}
        >
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </Field>
        {state === "error" && error && (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        )}
        <div className="flex items-center gap-3">
          <Button
            variant="danger"
            onClick={submit}
            loading={state === "saving"}
            disabled={confirmText !== CONFIRM_PHRASE || !password}
          >
            Schedule deletion
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Keep my account
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
