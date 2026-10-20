"use client";

import * as React from "react";
import { cn } from "@/lib/ui/cn";
import { Button } from "./button";

/**
 * Accessible dialog: role=dialog, aria-modal, Escape to close, focus moved in
 * and restored, scroll lock, and a backdrop click policy that never triggers
 * destructive actions accidentally (backdrop clicks only close `dismissible`).
 */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  dismissible?: boolean;
  className?: string;
}

export function Dialog({ open, onClose, title, description, children, footer, dismissible = true, className }: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const previousFocus = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && panel) {
        const items = Array.from(
          panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previousFocus.current?.focus?.();
    };
  }, [open, onClose, dismissible]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
      <div
        className="fixed inset-0 bg-navy-900/40"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "glass-strong relative z-10 w-full max-w-lg rounded-card shadow-pop outline-none",
          "max-h-[85vh] overflow-y-auto scrollbar-subtle animate-fade-in",
          className,
        )}
      >
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-navy">{title}</h2>
          {description && <p className="mt-1 text-sm leading-6 text-muted">{description}</p>}
        </div>
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line bg-ivory-100/60 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  requirePhrase,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  /** When set, the user must type this exact text to enable confirmation. */
  requirePhrase?: string;
  children?: React.ReactNode;
}) {
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const phraseOk = !requirePhrase || typed === requirePhrase;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      dismissible={!loading}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
            disabled={!phraseOk || loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {requirePhrase && (
        <div className="mt-3">
          <label htmlFor="confirm-phrase" className="mb-1.5 block text-sm font-medium text-charcoal">
            Type <span className="font-mono font-semibold">{requirePhrase}</span> to confirm
          </label>
          <input
            id="confirm-phrase"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            data-interactive
            autoComplete="off"
            className="w-full rounded-lg border border-line-dark px-3.5 py-2.5 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
          />
        </div>
      )}
    </Dialog>
  );
}
