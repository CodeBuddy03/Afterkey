"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/inputs";
import { Alert } from "@/components/ui/feedback";

const RULES = [
  { test: (p: string) => p.length >= 10, label: "At least 10 characters" },
  { test: (p: string) => /[a-zA-Z]/.test(p), label: "One letter" },
  { test: (p: string) => /[0-9]/.test(p), label: "One number" },
];

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const local: Record<string, string> = {};
    for (const rule of RULES) {
      if (!rule.test(password)) {
        local.password = `Password must include: ${RULES.filter((r) => !r.test(password)).map((r) => r.label.toLowerCase()).join(", ")}.`;
        break;
      }
    }
    if (password !== confirm) local.confirm = "Passwords do not match.";
    setErrors(local);
    if (Object.keys(local).length) return;

    setLoading(true);
    try {
      await api.post("/api/auth/password/reset", { token, password });
      setDone(true);
      setTimeout(() => router.push("/signin"), 2500);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="text-xl font-semibold text-navy">Reset link required</h1>
        <Alert tone="error" className="mt-3">
          This page needs a reset link from your email. Request a new one — links expire after one
          hour for your security.
        </Alert>
        <div className="mt-5">
          <Link href="/forgot-password" className="text-sm font-semibold text-navy underline decoration-champagne underline-offset-4">
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="text-xl font-semibold text-navy">Password updated</h1>
        <Alert tone="success" className="mt-3">
          Your password has been changed and other sessions have been signed out. Taking you to
          sign in…
        </Alert>
        <div className="mt-5">
          <Link href="/signin" className="text-sm font-semibold text-navy underline decoration-champagne underline-offset-4">
            Go to sign in now
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-navy">Choose a new password</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          This link is single-use and expires one hour after it was sent.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}

        <Field label="New password" required error={errors.password}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            required
            autoFocus
          />
        </Field>

        <ul className="-mt-2 space-y-1" aria-label="Password requirements">
          {RULES.map((rule) => {
            const met = rule.test(password);
            return (
              <li
                key={rule.label}
                className={`text-xs ${met ? "text-confirmed" : "text-muted"}`}
              >
                <span aria-hidden="true">{met ? "✓ " : "○ "}</span>
                {rule.label}
                <span className="sr-only">{met ? " — met" : " — not met yet"}</span>
              </li>
            );
          })}
        </ul>

        <Field label="Confirm new password" required error={errors.confirm}>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            invalid={Boolean(errors.confirm)}
            required
          />
        </Field>

        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Update password
        </Button>
      </form>
    </div>
  );
}
