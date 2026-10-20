"use client";

import * as React from "react";
import { Download, FileText, Pencil, Search, Trash2, Upload } from "lucide-react";
import { api, errorMessage } from "@/lib/api/client";
import { Button, Spinner } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, SaveStatus, type SaveState } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/inputs";

interface Doc {
  id: string;
  title: string;
  category: string;
  notes: string | null;
  tags: string[];
  filename: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
  uploadedAt: string;
}

const CATEGORIES = [
  ["financial", "Financial"],
  ["property", "Property"],
  ["identity", "Identity"],
  ["legal", "Legal"],
  ["medical", "Medical"],
  ["memory", "Memory"],
  ["export", "Export"],
  ["other", "Other"],
] as const;

const catLabel = (v: unknown) => CATEGORIES.find(([k]) => k === v)?.[1] ?? String(v ?? "—");

function fmtBytes(n: number): string {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Documents: upload with progress, list, rename, download, delete. */
export function DocumentsClient() {
  const [items, setItems] = React.useState<Doc[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [searchInput, setSearchInput] = React.useState("");
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<Doc | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Doc | null>(null);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setQ(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const res = await api.get<{ items: Doc[]; total: number }>(
          `/api/documents${q ? `?q=${encodeURIComponent(q)}` : ""}`,
        );
        if (signal?.aborted) return;
        setItems(res.items ?? []);
        setTotal(res.total ?? 0);
      } catch (err) {
        if (!signal?.aborted) {
          setError(errorMessage(err));
          setItems([]);
        }
      }
    },
    [q],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function download(doc: Doc) {
    setDownloadingId(doc.id);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/download`, {
        headers: { "x-requested-with": "afterkey" },
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename || "document";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloadingId(null);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    try {
      await api.delete(`/api/documents/${deleteTarget.id}`);
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
        title="Documents"
        description="PDFs, images and videos stored encrypted at rest. Files are sealed with your vault key before they touch storage and only decrypt through this authorized API — there are no public links."
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Upload size={16} aria-hidden="true" />
            Upload document
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search documents…"
            aria-label="Search documents"
            className="pl-9"
          />
        </div>
        <Button variant="ghost" onClick={() => void load()} aria-label="Refresh">
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader
          title="Your documents"
          description={items ? `${items.length} of ${total} shown · ${fmtBytes(items.reduce((s, d) => s + (Number(d.sizeBytes) || 0), 0))} total` : "Loading…"}
        />
        {items === null ? (
          <CardBody>
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
              <Spinner className="text-navy" /> Loading documents…
            </div>
          </CardBody>
        ) : items.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<FileText size={20} />}
              title={q ? "No documents match your search" : "No documents yet"}
              description={
                q
                  ? "Try a different search term or clear the box."
                  : "Upload your most important papers first: insurance policies, the deed to your home, a will. Encrypted on arrival."
              }
              action={
                !q && (
                  <Button onClick={() => setUploadOpen(true)}>
                    <Upload size={16} aria-hidden="true" />
                    Upload your first document
                  </Button>
                )
              }
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="flex min-w-0 gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy">
                    <FileText size={18} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-navy">{doc.title}</h3>
                      <Badge tone="navy">{catLabel(doc.category)}</Badge>
                      <Badge tone={doc.scanStatus === "clean" || doc.scanStatus === "skipped" ? "success" : doc.scanStatus === "infected" ? "danger" : "warn"}>
                        {doc.scanStatus === "skipped" ? "encrypted" : doc.scanStatus}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {doc.filename} · {fmtBytes(Number(doc.sizeBytes))} · uploaded {fmtDate(doc.uploadedAt)}
                    </p>
                    {Array.isArray(doc.tags) && doc.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {doc.tags.map((t) => (
                          <Badge key={t} tone="neutral">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {doc.notes && <p className="mt-1.5 line-clamp-2 text-sm text-charcoal">{doc.notes}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    data-interactive
                    aria-label={`Download ${doc.title}`}
                    onClick={() => void download(doc)}
                    disabled={downloadingId === doc.id}
                    className="rounded-md p-1.5 text-muted hover:bg-ivory-200 hover:text-navy disabled:opacity-50"
                  >
                    {downloadingId === doc.id ? <Spinner className="h-4 w-4" /> : <Download size={15} />}
                  </button>
                  <button
                    type="button"
                    data-interactive
                    aria-label={`Edit ${doc.title}`}
                    onClick={() => setEditTarget(doc)}
                    className="rounded-md p-1.5 text-muted hover:bg-ivory-200 hover:text-navy"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    data-interactive
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => setDeleteTarget(doc)}
                    className="rounded-md p-1.5 text-muted hover:bg-danger-50 hover:text-danger"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onSaved={async () => {
            setUploadOpen(false);
            await load();
          }}
        />
      )}

      {editTarget && (
        <EditDialog
          doc={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            setEditTarget(null);
            await load();
          }}
        />
      )}

      {deleteTarget && (
        <Dialog open onClose={() => setDeleteTarget(null)} title="Delete this document?">
          <p className="text-sm leading-6 text-muted">
            “{deleteTarget.title}” will be removed from your vault. This is recorded in your audit
            log and cannot be undone from this screen.
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Keep document
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function UploadDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState("other");
  const [tags, setTags] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [state, setState] = React.useState<SaveState>("idle");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const MAX = 25 * 1024 * 1024;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!file) {
      setFormError("Choose a file to upload.");
      return;
    }
    if (file.size > MAX) {
      setFormError("Files must be 25 MB or smaller.");
      return;
    }
    setSaving(true);
    setState("saving");
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("title", title.trim() || file.name);
      fd.set("category", category);
      fd.set("tags", tags);
      fd.set("notes", notes);
      await api.upload("/api/documents", fd);
      setState("saved");
      await onSaved();
    } catch (err) {
      setSaving(false);
      setState("error");
      setFormError(errorMessage(err));
    }
  }

  return (
    <Dialog open onClose={onClose} title="Upload a document">
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}

        <div>
          <label htmlFor="doc-file" className="mb-1.5 block text-sm font-medium text-charcoal">
            File <span className="text-danger">*</span>
          </label>
          <input
            id="doc-file"
            ref={inputRef}
            type="file"
            data-interactive
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.mp4"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
              setState("unsaved");
            }}
            className="block w-full cursor-pointer rounded-lg border border-line-dark bg-surface px-3.5 py-2.5 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-ivory-200 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-navy hover:file:bg-ivory-100"
          />
          <p className="mt-1 text-xs text-muted">
            PDF, images, documents, CSV, text or MP4 · max 25 MB · encrypted before storage.
          </p>
        </div>

        <Field label="Title" description="Shown in your vault list." required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Home insurance policy 2026" maxLength={200} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tags" description="Comma-separated." optionalHint>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="insurance, home" />
          </Field>
        </div>

        <Field label="Notes" optionalHint>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </Field>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <SaveStatus state={state} />
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Upload
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function EditDialog({ doc, onClose, onSaved }: { doc: Doc; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [title, setTitle] = React.useState(doc.title);
  const [category, setCategory] = React.useState(doc.category);
  const [tags, setTags] = React.useState((doc.tags ?? []).join(", "));
  const [notes, setNotes] = React.useState(doc.notes ?? "");
  const [state, setState] = React.useState<SaveState>("idle");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    setState("saving");
    try {
      await api.patch(`/api/documents/${doc.id}`, {
        title: title.trim() || doc.title,
        category,
        tags: tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
        notes,
      });
      setState("saved");
      setTimeout(onSaved, 350);
    } catch (err) {
      setSaving(false);
      setState("error");
      setFormError(errorMessage(err));
    }
  }

  return (
    <Dialog open onClose={onClose} title="Edit document">
      <form onSubmit={save} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tags" description="Comma-separated." optionalHint>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes" optionalHint>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
        </Field>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <SaveStatus state={state} />
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save changes
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
