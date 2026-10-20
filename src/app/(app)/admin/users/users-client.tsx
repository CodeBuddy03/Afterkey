"use client";

import * as React from "react";
import { api, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/inputs";

interface AdminUser {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  status: string;
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
  createdAt: string;
  vaultId: string | null;
  activeSessions: number;
}

const STATUS_TONE: Record<string, "neutral" | "success" | "warn" | "danger" | "gold"> = {
  active: "success",
  unverified: "gold",
  suspended: "danger",
  deletion_pending: "warn",
  deleted: "neutral",
};

/** Admin user management: search, filter, suspend and reactivate accounts. */
export function AdminUsersClient() {
  const [items, setItems] = React.useState<AdminUser[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("status", status);
      const res = await api.get<{ items: AdminUser[] }>(`/api/admin/users?${params.toString()}`, { signal });
      if (!signal?.aborted) setItems(res.items ?? []);
    } catch (err) {
      if (!signal?.aborted && !(err instanceof DOMException && err.name === "AbortError")) {
        setError(errorMessage(err));
        setItems([]);
      }
    }
  }, [query, status]);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function setStatusFor(user: AdminUser, action: "suspend" | "activate") {
    setBusyId(user.id);
    setNotice(null);
    try {
      const res = await api.patch<{ status: string; revokedSessions?: number }>("/api/admin/users", { id: user.id, action });
      setNotice(
        action === "suspend"
          ? `${user.email} suspended · ${res.revokedSessions ?? 0} session(s) revoked.`
          : `${user.email} reactivated.`,
      );
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
        title="Users"
        description="Every account on AfterKey. Suspending revokes all sessions immediately; it never exposes vault contents."
      />
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Search">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="email or name"
                autoComplete="off"
              />
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                <option value="active">Active</option>
                <option value="unverified">Unverified</option>
                <option value="suspended">Suspended</option>
                <option value="deletion_pending">Deletion pending</option>
              </Select>
            </Field>
          </div>
          {notice && (
            <Alert tone="info" role="status">
              {notice}
            </Alert>
          )}
          {error && <ErrorState message={error} onRetry={() => void load()} />}
          {items === null ? (
            <LoadingState label="Loading accounts…" />
          ) : items.length === 0 ? (
            <EmptyState title="No accounts match" description="Adjust the search or filter." />
          ) : (
            <ul className="divide-y divide-line">
              {items.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-navy">
                      {u.fullName ?? u.email}
                      {u.role === "admin" && (
                        <Badge tone="navy" className="ml-2">admin</Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {u.email} · joined {new Date(u.createdAt).toLocaleDateString()} ·{" "}
                      {u.emailVerifiedAt ? "verified" : "unverified"} · {u.mfaEnabled ? "2FA on" : "no 2FA"} ·{" "}
                      {u.activeSessions} session(s)
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={STATUS_TONE[u.status] ?? "neutral"}>{u.status.replace("_", " ")}</Badge>
                    {u.role !== "admin" &&
                      (u.status === "suspended" ? (
                        <Button size="sm" variant="secondary" loading={busyId === u.id} onClick={() => void setStatusFor(u, "activate")}>
                          Reactivate
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" loading={busyId === u.id} onClick={() => void setStatusFor(u, "suspend")}>
                          Suspend
                        </Button>
                      ))}
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
