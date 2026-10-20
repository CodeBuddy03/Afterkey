"use client";

import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Minimal toast system: aria-live announcements, dismissible, auto-hide with
 * a pause on hover/focus. Used for transient success/error confirmations.
 */

export interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  message: string;
}

interface ToastContextValue {
  push: (tone: Toast["tone"], message: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const push = React.useCallback((tone: Toast["tone"], message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  const dismiss = React.useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            aria-live={toast.tone === "error" ? "assertive" : "polite"}
            className={cn(
              "glass-strong pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-pop animate-fade-in",
              toast.tone === "success" && "border-confirmed-50",
              toast.tone === "error" && "border-danger-50",
              toast.tone === "info" && "border-line-dark",
            )}
          >
            <span
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                toast.tone === "success" && "bg-confirmed",
                toast.tone === "error" && "bg-danger",
                toast.tone === "info" && "bg-navy-300",
              )}
              aria-hidden="true"
            />
            <span className="leading-6 text-charcoal">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              data-interactive
              className="ml-auto -mr-1 rounded p-1 text-muted hover:text-navy"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
