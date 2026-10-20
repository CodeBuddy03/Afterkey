"use client";

import * as React from "react";
import { UserPlus, ShieldCheck, Trash2, RefreshCw } from "lucide-react";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button, Spinner } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, SaveStatus, type SaveState } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/inputs";

const CATEGORIES = [
  { value: "financial", label: "Financial records" },
  { value: "digital", label: "Digital accounts" },
  { value: "documents", label: "Documents" },
  { value: "properties", label: "Properties" },
  { value: "messages", label: "Legacy messages" },
] as const;

interface Recipient {
  id: string;
  displayName: string;
  email: string;
  relationship: string | null;
  status: string;
  accepted: boolean;
  grantedCategories: string[] | null;
  inviteExpiresAt: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, "neutral" | "gold" | "success" | "warn" | "danger"> = {
  invited: "gold",
  active: "success",
  suspended: "warn",
  revoked: "danger",
};

/** Trusted recipients: invite, scope permissions, revoke. */
export function RecipientsClient() {
  const [items, setItems] = React.useState<Recipient[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<Recipient | null>(null);
  const [editTarget, setEditTarget] = React.useState<Recipient | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const res = await api.get<{ items: Recipient[] }>("/api/recipients");
      if (!signal?.aborted) setItems(res.items ?? []);
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

  async function revoke() {
    if (!revokeTarget) return;
    try {
      await api.delete(`/api/recipients/${revokeTarget.id}`);
      setRevokeTarget(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
      setRevokeTarget(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Trusted recipients"
        description="The people who could receive content if a release case completes. Each one gets an explicit, revocable scope — recipients never inherit each other's access."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => void load()} aria-label="Refresh">
              <RefreshCw size={15} aria-hidden="true" />
            </Button>
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus size={16} aria-hidden="true" />
              Invite recipient
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="error" title="Something went wrong">
            {error}
          </Alert>
        </div>
      )}

      <div className="mb-4 flex gap-2.5 rounded-lg border border-navy-100 bg-navy-50 px-4 py-3 text-sm leading-6 text-navy-700">
        <ShieldCheck size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          Invitations expire after 14 days. Revoking a recipient ends their access immediately,
          including pending invitations, and every change is written to your audit log.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Recipients"
          description={items ? `${items.length} total` : "Loading…"}
        />
        {items === null ? (
          <CardBody>
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
              <Spinner className="text-navy" /> Loading recipients…
            </div>
          </CardBody>
        ) : items.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<UserPlus size={20} />}
              title="No recipients yet"
              description="Invite one person you trust — your spouse, a sibling, an executor. They can't see anything until a release actually happens under your conditions."
              action={<Button onClick={() => setInviteOpen(true)}>Invite recipient</Button>}
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-navy">{r.displayName}</h3>
                    <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                    {r.accepted && <Badge tone="success">accepted</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {r.email}
                    {r.relationship ? ` · ${r.relationship}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(r.grantedCategories ?? []).length === 0 ? (
                      <Badge tone="warn">no permissions yet</Badge>
                    ) : (
                      (r.grantedCategories ?? []).map((cat) => (
                        <Badge key={cat} tone="navy">
                          {CATEGORIES.find((c) => c.value === cat)?.label ?? cat}
                        </Badge>
                      ))
                    )}
                  </div>
                  {!r.accepted && r.status === "invited" && (
                    <p className="mt-1.5 text-xs text-muted">
                      Invitation {r.inviteExpiresAt ? `expires ${new Date(r.inviteExpiresAt).toLocaleDateString()}` : "sent"}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditTarget(r)}>
                    Permissions
                  </Button>
                  {r.status !== "revoked" && (
                    <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(r)}>
                      <Trash2 size={14} aria-hidden="true" />
                      Revoke
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {inviteOpen && (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          onSaved={async () => {
            setInviteOpen(false);
            await load();
          }}
        />
      )}

      {editTarget && (
        <PermissionsDialog
          recipient={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            setEditTarget(null);
            await load();
          }}
        />
      )}

      {revokeTarget && (
        <Dialog open onClose={() => setRevokeTarget(null)} title={`Revoke ${revokeTarget.displayName}?`}>
          <Alert tone="warn" title="This takes effect immediately">
            {revokeTarget.email} will lose all access, pending invitations are cancelled, and their
            permissions are deleted. You can invite them again later.
          </Alert>
          <div className="mt-5 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
              Keep recipient
            </Button>
            <Button variant="danger" onClick={() => void revoke()}>
              Revoke access
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function InviteDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [values, setValues] = React.useState({
    displayName: "",
    email: "",
    relationship: "",
    permissions: [] as string[],
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [state, setState] = React.useState<SaveState>("idle");
  const [saving, setSaving] = React.useState(false);

  function togglePermission(value: string, checked: boolean) {
    setValues((v) => ({
      ...v,
      permissions: checked ? [...v.permissions, value] : v.permissions.filter((p) => p !== value),
    }));
    setState("unsaved");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const local: Record<string, string> = {};
    if (!values.displayName.trim()) local.displayName = "Name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) local.email = "Enter a valid email address.";
    if (!values.permissions.length) local.permissions = "Choose at least one category to share.";
    setErrors(local);
    if (Object.keys(local).length) return;

    setSaving(true);
    setState("saving");
    try {
      await api.post("/api/recipients", {
        displayName: values.displayName.trim(),
        email: values.email.trim().toLowerCase(),
        relationship: values.relationship.trim() || undefined,
        permissions: values.permissions,
      });
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
    <Dialog open onClose={onClose} title="Invite a trusted recipient">
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}

        <Field label="Their name" required error={errors.displayName}>
          <Input
            value={values.displayName}
            onChange={(e) => setValues((v) => ({ ...v, displayName: e.target.value }))}
            placeholder="e.g. Wanjiku Mwangi"
            invalid={Boolean(errors.displayName)}
          />
        </Field>

        <Field
          label="Their email"
          description="They'll receive an invitation to create their own account. We never share your credentials."
          required
          error={errors.email}
        >
          <Input
            type="email"
            value={values.email}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
            placeholder="them@example.com"
            invalid={Boolean(errors.email)}
          />
        </Field>

        <Field label="Relationship" optionalHint>
          <Input
            value={values.relationship}
            onChange={(e) => setValues((v) => ({ ...v, relationship: e.target.value }))}
            placeholder="e.g. Spouse, Executor"
            maxLength={80}
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-charcoal">
            What they may receive <span className="text-danger">*</span>
          </legend>
          <p className="mb-2.5 text-xs leading-5 text-muted">
            Categories disclosed to this person if a release case completes. You can change this at
            any time.
          </p>
          <div className="space-y-2.5">
            {CATEGORIES.map((cat) => (
              <Checkbox
                key={cat.value}
                label={cat.label}
                checked={values.permissions.includes(cat.value)}
                onChange={(e) => togglePermission(cat.value, e.target.checked)}
              />
            ))}
          </div>
          {errors.permissions && (
            <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
              {errors.permissions}
            </p>
          )}
        </fieldset>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <SaveStatus state={state} />
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Send invitation
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function PermissionsDialog({
  recipient,
  onClose,
  onSaved,
}: {
  recipient: Recipient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [selected, setSelected] = React.useState<string[]>(recipient.grantedCategories ?? []);
  const [state, setState] = React.useState<SaveState>("idle");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  function toggle(value: string, checked: boolean) {
    setSelected((prev) => (checked ? [...prev, value] : prev.filter((v) => v !== value)));
    setState("unsaved");
  }

  async function save() {
    setSaving(true);
    setState("saving");
    try {
      await api.patch(`/api/recipients/${recipient.id}`, { permissions: selected });
      setState("saved");
      setTimeout(onSaved, 400);
    } catch (err) {
      setSaving(false);
      setState("error");
      setFormError(errorMessage(err));
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Permissions — ${recipient.displayName}`}>
      <div className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <p className="text-sm leading-6 text-muted">
          Exactly what {recipient.displayName} may receive if a release case completes. Nothing
          outside this list is ever disclosed to them.
        </p>
        <div className="space-y-2.5">
          {CATEGORIES.map((cat) => (
            <Checkbox
              key={cat.value}
              label={cat.label}
              checked={selected.includes(cat.value)}
              onChange={(e) => toggle(cat.value, e.target.checked)}
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <SaveStatus state={state} />
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Close
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              Save permissions
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
