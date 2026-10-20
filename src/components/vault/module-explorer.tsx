"use client";

import * as React from "react";
import { Plus, Search, Archive, Pencil, X } from "lucide-react";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { cn } from "@/lib/ui/cn";
import { Button, Spinner } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, SaveStatus, type SaveState } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/inputs";

/**
 * Generic list + create/edit dialog for a flat vault module. The server owns
 * authorization and encryption; this component only renders state and posts
 * plain JSON to the module's endpoint.
 */

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select" | "date" | "email" | "url" | "tel";
  options?: { value: string; label: string }[];
  description?: string;
  placeholder?: string;
  required?: boolean;
  half?: boolean;
  max?: number;
}

export interface ColumnDef {
  name: string;
  label: string;
  render?: (item: Record<string, unknown>) => React.ReactNode;
}

export interface ModuleExplorerProps {
  title: string;
  description: string;
  endpoint: string;
  createLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  fields: FieldDef[];
  columns: ColumnDef[];
  filter?: { param: string; label: string; options: { value: string; label: string }[] };
  searchable?: boolean;
  actions?: React.ReactNode;
}

type Item = Record<string, unknown>;

function itemValue(item: Item, key: string): string {
  const v = item[key];
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export function ModuleExplorer({
  title,
  description,
  endpoint,
  createLabel,
  emptyTitle,
  emptyDescription,
  fields,
  columns,
  filter,
  searchable = true,
  actions,
}: ModuleExplorerProps) {
  const [items, setItems] = React.useState<Item[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [filterValue, setFilterValue] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Item | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Item | null>(null);

  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (filterValue && filter) params.set(filter.param, filterValue);
        const qs = params.toString();
        const res = await api.get<{ items: Item[] }>(`${endpoint}${qs ? `?${qs}` : ""}`);
        if (!signal?.aborted) setItems(res.items ?? []);
      } catch (err) {
        if (!signal?.aborted) {
          setError(errorMessage(err));
          setItems([]);
        }
      }
    },
    [endpoint, q, filterValue, filter],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Debounce search typing.
  const [searchInput, setSearchInput] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setQ(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(item: Item) {
    setEditing(item);
    setDialogOpen(true);
  }

  async function onDelete(confirmed: boolean) {
    if (!confirmed || !deleteTarget) return;
    try {
      await api.delete(`${endpoint}/${deleteTarget.id}`);
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
        title={title}
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <Button onClick={openCreate}>
              <Plus size={16} aria-hidden="true" />
              {createLabel}
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {searchable && (
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search…"
              aria-label={`Search ${title.toLowerCase()}`}
              className="pl-9"
            />
          </div>
        )}
        {filter && (
          <Select
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            aria-label={filter.label}
            className="w-auto min-w-[10rem]"
          >
            <option value="">All</option>
            {filter.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        )}
        <Button variant="ghost" onClick={() => void load()} aria-label="Refresh list">
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <Alert tone="error" title="Couldn't load">
            {error}
          </Alert>
        </div>
      )}

      <Card>
        <CardHeader title={title} description={items ? `${items.length} item${items.length === 1 ? "" : "s"}` : "Loading…"} />
        {items === null ? (
          <CardBody>
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
              <Spinner className="text-navy" /> Loading your records…
            </div>
          </CardBody>
        ) : items.length === 0 ? (
          <CardBody>
            <EmptyState
              title={error ? "Nothing to show right now" : emptyTitle}
              description={emptyDescription}
              action={
                <Button onClick={openCreate}>
                  <Plus size={16} aria-hidden="true" />
                  {createLabel}
                </Button>
              }
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto scrollbar-subtle">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-ivory-100/60 text-left text-xs uppercase tracking-wide text-muted">
                  {columns.map((col) => (
                    <th key={col.name} scope="col" className="px-4 py-2.5 font-semibold">
                      {col.label}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={String(item.id)} className="border-b border-line last:border-0 hover:bg-ivory-100/40">
                    {columns.map((col) => (
                      <td key={col.name} className="max-w-[22rem] px-4 py-3 text-charcoal">
                        {col.render ? col.render(item) : itemValue(item, col.name) || <span className="text-muted">—</span>}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          data-interactive
                          aria-label="Edit"
                          className="rounded-md p-1.5 text-muted hover:bg-ivory-200 hover:text-navy"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(item)}
                          data-interactive
                          aria-label="Archive"
                          className="rounded-md p-1.5 text-muted hover:bg-danger-50 hover:text-danger"
                        >
                          <Archive size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialogOpen && (
        <RecordDialog
          title={editing ? `Edit ${title.replace(/s$/, "")}` : createLabel}
          fields={fields}
          endpoint={endpoint}
          item={editing}
          onClose={() => setDialogOpen(false)}
          onSaved={async () => {
            setDialogOpen(false);
            await load();
          }}
        />
      )}

      {deleteTarget && (
        <Dialog open onClose={() => setDeleteTarget(null)} title={`Archive this ${title.toLowerCase().replace(/s$/, "")}?`}>
          <p className="text-sm leading-6 text-muted">
            It will be hidden from your list but kept in your vault. You can restore it later from
            archived items — nothing is permanently destroyed by this action.
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void onDelete(true)}>
              Archive
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function RecordDialog({
  title,
  fields,
  endpoint,
  item,
  onClose,
  onSaved,
}: {
  title: string;
  fields: FieldDef[];
  endpoint: string;
  item: Item | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) initial[f.name] = item ? itemValue(item, f.name) : "";
    return initial;
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [state, setState] = React.useState<SaveState>("idle");
  const [saving, setSaving] = React.useState(false);

  function set(name: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValues((v) => ({ ...v, [name]: e.target.value }));
      setErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
      setState("unsaved");
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const local: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && !values[f.name]?.trim()) local[f.name] = `${f.label} is required.`;
    }
    setErrors(local);
    if (Object.keys(local).length) return;

    setSaving(true);
    setState("saving");
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.name];
      payload[f.name] = raw === "" ? (f.type === "date" ? null : undefined) : raw;
    }

    try {
      if (item) {
        await api.patch(`${endpoint}/${item.id}`, payload);
      } else {
        await api.post(endpoint, payload);
      }
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
    <Dialog open onClose={onClose} title={title}> 
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => {
            const common = {
              value: values[f.name] ?? "",
              onChange: set(f.name),
              invalid: Boolean(errors[f.name]),
              placeholder: f.placeholder,
              maxLength: f.max,
              "aria-label": f.label,
            };
            const control =
              f.type === "textarea" ? (
                <Textarea {...common} rows={4} />
              ) : f.type === "select" ? (
                <Select {...common}>
                  <option value="">{f.placeholder ?? "Choose…"}</option>
                  {(f.options ?? []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...common} type={f.type ?? "text"} />
              );
            return (
              <Field
                key={f.name}
                label={f.label}
                description={f.description}
                error={errors[f.name]}
                required={f.required}
                className={f.half ? "" : "sm:col-span-2"}
              >
                {control}
              </Field>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <SaveStatus state={state} />
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {item ? "Save changes" : "Create"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** Small helper for rendering a masked/none value consistently in tables. */
export function CellText({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted">—</span>;
  }
  return <span>{String(value)}</span>;
}

export function TagRow({ tags }: { tags: unknown }) {
  if (!Array.isArray(tags) || !tags.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={String(t)} tone="neutral">
          {String(t)}
        </Badge>
      ))}
    </span>
  );
}

export { cn, X };
