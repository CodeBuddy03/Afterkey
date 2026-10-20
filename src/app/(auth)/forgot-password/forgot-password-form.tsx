"use client";

import * as React from "react";
import Link from "next/link";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/inputs";
import { Alert } from "@/components/ui/feedback";

/** POST /api/auth/password/forgot — always succeeds visibly (no enumeration). */
export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrorsState, setFieldErrors] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setFieldErrors({ email: "Email is required." });
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/password/forgot", { email: email.trim() });
      setSent(true);
    } catch (err) {
      setFieldErrors(fieldErrors(err));
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
        <h1 className="text-xl font-semibold text-navy">Check your inbox</h1>
        <Alert tone="success" className="mt-3" title="Request received">
          If an account exists for {email}, a password reset link is on its way. The link expires
          in one hour. If nothing arrives in a few minutes, check spam before contacting support.
        </Alert>
        <div className="mt-5 flex flex-wrap gap-4 text-sm">
          <Link href="/signin" className="font-semibold text-navy underline decoration-champagne underline-offset-4">
            Back to sign in
          </Link>
          <Link href="/contact" className="font-medium text-muted underline underline-offset-4 hover:text-navy">
            Contact support
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-navy">Forgot your password?</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          Enter the email on your account and we&apos;ll send a secure reset link.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field
          label="Email address"
          description="For your security, the confirmation message is the same whether or not an account exists."
          required
          error={fieldErrorsState.email}
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            invalid={Boolean(fieldErrorsState.email)}
            required
            autoFocus
          />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Send reset link
        </Button>
      </form>

      <p className="mt-5 border-t border-line pt-4 text-center text-sm text-muted">
        Remembered it?{" "}
        <Link href="/signin" className="font-semibold text-navy underline decoration-champagne underline-offset-4">
          Sign in
        </Link>
        {" · "}
        <Link href="/recovery" className="font-medium text-navy underline decoration-champagne underline-offset-4">
          Use recovery phrase
        </Link>
      </p>
    </div>
  );
}
