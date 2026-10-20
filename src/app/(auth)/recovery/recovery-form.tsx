"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/inputs";
import { Alert } from "@/components/ui/feedback";

/**
 * Two-step account recovery with the recovery phrase:
 *   1. phrase + email → single-use challenge
 *   2. challenge + new password → account recovered
 */
export function RecoveryForm() {
  const router = useRouter();
  const [step, setStep] = React.useState<1 | 2>(1);
  const [phrase, setPhrase] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function onStep1(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const local: Record<string, string> = {};
    if (!email.trim()) local.email = "Email is required.";
    if (phrase.trim().split(/\s+/).length < 12) local.phrase = "Enter all 24 words of your recovery phrase.";
    setErrors(local);
    if (Object.keys(local).length) return;

    setLoading(true);
    try {
      const res = await api.post<{ challenge: string }>("/api/auth/recovery", {
        email: email.trim(),
        phrase: phrase.trim(),
      });
      setChallenge(res.challenge);
      setStep(2);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function onStep2(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const local: Record<string, string> = {};
    if (password.length < 10) local.password = "Use at least 10 characters.";
    else if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password))
      local.password = "Include at least one letter and one number.";
    if (password !== confirm) local.confirm = "Passwords do not match.";
    setErrors(local);
    if (Object.keys(local).length) return;

    setLoading(true);
    try {
      await api.post("/api/auth/recovery/complete", { challenge, password });
      setDone(true);
      setTimeout(() => router.push("/signin"), 3000);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="text-xl font-semibold text-navy">Account recovered</h1>
        <Alert tone="success" className="mt-3">
          Your password has been replaced and other sessions were signed out. You can sign in now
          with your new password.
        </Alert>
        <div className="mt-5">
          <Link href="/signin" className="text-sm font-semibold text-navy underline decoration-champagne underline-offset-4">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-navy">Recover with your phrase</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            Enter the 24-word recovery phrase you saved when you secured your account, plus your
            email address.
          </p>
        </div>

        <Alert tone="warn" className="mt-4" title="Keep it private">
          AfterKey will never ask for your recovery phrase by email, phone or chat. Only enter it
          on this page.
        </Alert>

        <form onSubmit={onStep1} noValidate className="mt-5 space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}

          <Field label="Email address" required error={errors.email}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              invalid={Boolean(errors.email)}
              required
            />
          </Field>

          <Field
            label="Recovery phrase"
            description="24 words, separated by spaces. Order matters."
            required
            error={errors.phrase}
          >
            <Textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="min-h-[96px] font-mono text-sm"
              invalid={Boolean(errors.phrase)}
              required
            />
          </Field>

          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Verify phrase
          </Button>
        </form>

        <p className="mt-5 border-t border-line pt-4 text-center text-sm text-muted">
          Lost your phrase?{" "}
          <Link href="/forgot-password" className="font-medium text-navy underline decoration-champagne underline-offset-4">
            Use your password instead
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onStep2} noValidate className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-navy">Set a new password</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          Phrase verified. Choose a new password to finish recovering your account.
        </p>
      </div>

      <div className="mt-6 space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}

        <Field label="New password" description="At least 10 characters, with a letter and a number." required error={errors.password}>
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
          Finish recovery
        </Button>
      </div>
    </form>
  );
}
