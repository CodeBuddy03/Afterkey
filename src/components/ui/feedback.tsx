import * as React from "react";
import { cn } from "@/lib/ui/cn";
import { Spinner } from "./button";

/** Feedback: alerts, badges, empty states, loading and save-status. */

type AlertTone = "info" | "success" | "warn" | "error";

const ALERT_TONES: Record<AlertTone, string> = {
  info: "border-navy-100 bg-navy-50 text-navy-700",
  success: "border-confirmed-50 bg-confirmed-50 text-confirmed-700",
  warn: "border-warn-50 bg-warn-50 text-warn-700",
  error: "border-danger-50 bg-danger-50 text-danger-700",
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role ?? (tone === "error" ? "alert" : "status")}
      className={cn("rounded-lg border px-4 py-3 text-sm leading-6", ALERT_TONES[tone], className)}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1", "whitespace-pre-line")}>{children}</div>}
    </div>
  );
}

type BadgeTone = "neutral" | "gold" | "success" | "warn" | "danger" | "navy";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-ivory-100 text-muted border-line-dark",
  gold: "bg-champagne/15 text-champagne-700 border-champagne/40",
  success: "bg-confirmed-50 text-confirmed-700 border-confirmed-50",
  warn: "bg-warn-50 text-warn-700 border-warn-50",
  danger: "bg-danger-50 text-danger-700 border-danger-50",
  navy: "bg-navy-50 text-navy-700 border-navy-100",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2.5 rounded-card border border-line bg-surface px-4 py-10 text-sm text-muted", className)}>
      <Spinner className="text-navy" />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-ivory-200", className)} aria-hidden="true" />;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-card border border-dashed border-line-dark bg-ivory-100/50 px-6 py-10 text-center", className)}>
      {icon && <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface text-navy shadow-sm">{icon}</div>}
      <h3 className="text-sm font-semibold text-navy">{title}</h3>
      {description && <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message = "Something went wrong.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-card border border-danger-50 bg-danger-50 px-5 py-4" role="alert">
      <p className="text-sm font-medium text-danger-700">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          data-interactive
          className="mt-2 text-sm font-semibold text-navy underline decoration-champagne underline-offset-4"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

/** Visible save status required by the UX rules (saving/saved/unsaved/error). */
export function SaveStatus({ state, error, className }: { state: SaveState; error?: string | null; className?: string }) {
  if (state === "idle") return null;
  const map: Record<Exclude<SaveState, "idle">, { text: string; className: string }> = {
    unsaved: { text: "Unsaved changes", className: "text-warn-700" },
    saving: { text: "Saving…", className: "text-muted" },
    saved: { text: "Saved", className: "text-confirmed" },
    error: { text: error ? `Not saved — ${error}` : "Not saved", className: "text-danger" },
  };
  const entry = map[state as Exclude<SaveState, "idle">];
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5 text-xs font-medium", entry.className, className)}>
      {state === "saving" && <Spinner className="h-3 w-3" />}
      {entry.text}
    </span>
  );
}
