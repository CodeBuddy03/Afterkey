"use client";

import * as React from "react";
import { Plus, Pencil, Archive, Users } from "lucide-react";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button, Spinner } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, SaveStatus, type SaveState } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/inputs";

interface MessageItem {
  id: string;
  title: string;
  body: string | null;
  recipientId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  intendedLabel: string | null;
  relationship: string | null;
  releasePolicy: "manual" | "on_release";
  status: string;
  updatedAt: string;
  documentCount?: number;
}

interface Recipient {
  id: string;
  displayName: string;
  email: string;
  status: string;
}

const STATUS_TONE: Record<string, "neutral" | "gold" | "success" | "warn"> = {
  draft: "neutral",
  ready: "gold",
  scheduled: "gold",
  released: "success",
  archived: "neutral",
};

/** Legacy messages: letters for specific people, released only on your terms. */
export function MessagesClient() {
  const [items, setItems] = React.useState<MessageItem[] | null>(null);
  const [recipients, setRecipients] = React.useState<Recipient[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<MessageItem | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<MessageItem | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const [messages, recs] = await Promise.all([
        api.get<{ items: MessageItem[] }>("/api/messages"),
        api.get<{ items: Recipient[] }>("/api/recipients").catch(() => ({ items: [] as Recipient[] })),
      ]);
      if (signal?.aborted) return;
      setItems(messages.items ?? []);
      setRecipients((recs.items ?? []).filter((r) => r.status !== "revoked"));
    } catch (err) {
      if (!signal?.aborted) {
        setError(errorMessage(err));
        setItems([]);
      }
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function archive() {
    if (!deleteTarget) return;
    try {
      await api.delete(`/api/messages/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
      setDeleteTarget(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Legacy messages"
        description="Letters, wishes and instructions for the people you choose. Draft anything now; nothing is delivered unless you release it — manually or under your configured release conditions."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus size={16} aria-hidden="true" />
            Write a message
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="error" title="Something went wrong">
            {error}
          </Alert>
        </div>
      )}

      <div className="mb-4 rounded-lg border border-navy-100 bg-navy-50 px-4 py-3 text-sm leading-6 text-navy-700">
        <strong className="font-semibold">How release works:</strong> messages marked{" "}
        <em>“on release”</em> are disclosed to their recipient only if a release case completes
        after your configured checks. Messages marked <em>“manual”</em> are only ever shared when
        you send them yourself.
      </div>

      <Card>
        <CardHeader
          title="Your messages"
          description={items ? `${items.length} message${items.length === 1 ? "" : "s"}` : "Loading…"}
        />
        {items === null ? (
          <CardBody>
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
              <Spinner className="text-navy" /> Loading messages…
            </div>
          </CardBody>
        ) : items.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Users size={20} />}
              title="No messages yet"
              description="Write one letter tonight — for a birthday that hasn't happened, or the advice you'd want remembered. It stays private until you say otherwise."
              action={
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  Write a message
                </Button>
              }
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-navy">{item.title}</h3>
                    <Badge tone={STATUS_TONE[item.status] ?? "neutral"}>{item.status}</Badge>
                    <Badge tone={item.releasePolicy === "on_release" ? "gold" : "neutral"}>
                      {item.releasePolicy === "on_release" ? "on release" : "manual"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    For:{" "}
                    {item.recipientName
                      ? `${item.recipientName} (${item.recipientEmail})`
                      : item.intendedLabel || "Unassigned"}
                  </p>
                  {item.body && (
                    <p className="mt-1.5 line-clamp-2 max-w-2xl text-sm leading-6 text-charcoal">
                      {item.body}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    data-interactive
                    aria-label={`Edit ${item.title}`}
                    onClick={() => {
                      setEditing(item);
                      setDialogOpen(true);
                    }}
                    className="rounded-md p-1.5 text-muted hover:bg-ivory-200 hover:text-navy"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    data-interactive
                    aria-label={`Archive ${item.title}`}
                    onClick={() => setDeleteTarget(item)}
                    className="rounded-md p-1.5 text-muted hover:bg-danger-50 hover:text-danger"
                  >
                    <Archive size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialogOpen && (
        <MessageDialog
          item={editing}
          recipients={recipients}
          onClose={() => setDialogOpen(false)}
          onSaved={async () => {
            setDialogOpen(false);
            await load();
          }}
        />
      )}

      {deleteTarget && (
        <Dialog
          open
          onClose={() => setDeleteTarget(null)}
          title="Archive this message?"
        >
          <p className="text-sm leading-6 text-muted">
            “{deleteTarget.title}” will be hidden from your list but kept in your vault. Nothing is
            permanently destroyed.
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void archive()}>
              Archive
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function MessageDialog({
  item,
  recipients,
  onClose,
  onSaved,
}: {
  item: MessageItem | null;
  recipients: Recipient[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [values, setValues] = React.useState({
    title: item?.title ?? "",
    body: item?.body ?? "",
    recipientId: item?.recipientId ?? "",
    intendedLabel: item?.intendedLabel ?? "",
    relationship: item?.relationship ?? "",
    releasePolicy: item?.releasePolicy ?? "manual",
    status: item?.status === "archived" ? "draft" : item?.status ?? "draft",
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [state, setState] = React.useState<SaveState>("idle");
  const [saving, setSaving] = React.useState(false);

  function upd(key: keyof typeof values) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValues((v) => ({ ...v, [key]: e.target.value }));
      setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
      setState("unsaved");
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const local: Record<string, string> = {};
    if (!values.title.trim()) local.title = "Give the message a title.";
    if (!values.body.trim()) local.body = "Write the message body.";
    setErrors(local);
    if (Object.keys(local).length) return;

    setSaving(true);
    setState("saving");
    const payload = {
      title: values.title.trim(),
      body: values.body,
      recipientId: values.recipientId || null,
      intendedLabel: values.intendedLabel || undefined,
      relationship: values.relationship || undefined,
      releasePolicy: values.releasePolicy,
      status: values.status,
    };
    try {
      if (item) await api.patch(`/api/messages/${item.id}`, payload);
      else await api.post("/api/messages", payload);
      setState("saved");
      await onSaved();
    } catch (err) {
      setSaving(false);
      setState("error");
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  }

  return (
    <Dialog open onClose={onClose} title={item ? "Edit message" : "Write a message"} className="max-w-2xl">
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}

        <Field label="Title" required error={errors.title}>
          <Input
            value={values.title}
            onChange={upd("title")}
            placeholder="e.g. For Maya's wedding day"
            invalid={Boolean(errors.title)}
            maxLength={200}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Recipient" description="Only this person receives it — and only under the conditions below." error={errors.recipientId}>
            <Select value={values.recipientId} onChange={upd("recipientId")} invalid={Boolean(errors.recipientId)}>
              <option value="">No recipient yet (label only)</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.displayName} — {r.email}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Or describe who it's for" description="Shown instead if no recipient is linked." optionalHint>
            <Input
              value={values.intendedLabel}
              onChange={upd("intendedLabel")}
              placeholder="e.g. My daughter"
              maxLength={160}
            />
          </Field>

          <Field label="Relationship" optionalHint>
            <Input value={values.relationship} onChange={upd("relationship")} placeholder="e.g. Daughter" maxLength={80} />
          </Field>

          <Field label="Release policy" description="When this message can be shared.">
            <Select value={values.releasePolicy} onChange={upd("releasePolicy")}>
              <option value="manual">Manual — only when I send it</option>
              <option value="on_release">On release — if a release case completes</option>
            </Select>
          </Field>

          <Field label="Status">
            <Select value={values.status} onChange={upd("status")}>
              <option value="draft">Draft</option>
              <option value="ready">Ready</option>
              <option value="scheduled">Scheduled</option>
            </Select>
          </Field>
        </div>

        <Field
          label="Message"
          required
          error={errors.body}
          description="Written in your own words is best. Stored encrypted — readable only by you, until released."
        >
          <Textarea
            value={values.body}
            onChange={upd("body")}
            rows={9}
            placeholder="Dear…"
            invalid={Boolean(errors.body)}
            className="min-h-[180px]"
          />
        </Field>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <SaveStatus state={state} />
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {item ? "Save changes" : "Create message"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
