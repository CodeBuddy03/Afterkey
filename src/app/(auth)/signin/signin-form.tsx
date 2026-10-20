"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/inputs";
import { Alert } from "@/components/ui/feedback";

interface LoginSuccess {
  user: { id: string; email: string; emailVerified: boolean };
  requiresPasswordChange: boolean;
  next: string;
}

export function SigninForm() {
  const router = useRouter();
  const params = useSearchParams();

  const presetEmail = params.get("email") ?? "";
  const justRegistered = params.get("check") === "1";
  const nextPath = params.get("next");

  const [values, setValues] = React.useState({ email: presetEmail, password: "" });
  const [rememberDevice, setRememberDevice] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  // MFA step
  const [mfaToken, setMfaToken] = React.useState<string | null>(null);
  const [mfaCode, setMfaCode] = React.useState("");
  const [mfaError, setMfaError] = React.useState<string | null>(null);

  async function finishLogin(data: LoginSuccess) {
    const target =
      nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
        ? nextPath
        : data.next || "/dashboard";
    router.push(target);
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const local: Record<string, string> = {};
    if (!values.email.trim()) local.email = "Email is required.";
    if (!values.password) local.password = "Password is required.";
    setErrors(local);
    if (Object.keys(local).length) return;

    setLoading(true);
    try {
      const data = await api.post<
        LoginSuccess | { requiresMfa: true; mfaToken: string; expiresAt: string }
      >("/api/auth/login", {
        email: values.email.trim(),
        password: values.password,
        rememberDevice,
      });
      if (data && typeof data === "object" && "requiresMfa" in data && data.requiresMfa) {
        setMfaToken(data.mfaToken);
        setLoading(false);
        return;
      }
      await finishLogin(data as LoginSuccess);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
      setLoading(false);
    }
  }

  async function onMfa(e: React.FormEvent) {
    e.preventDefault();
    setMfaError(null);
    if (!mfaCode.trim()) {
      setMfaError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setLoading(true);
    try {
      const data = await api.post<LoginSuccess>("/api/auth/mfa", {
        mfaToken,
        code: mfaCode.trim(),
      });
      await finishLogin(data);
    } catch (err) {
      setMfaError(errorMessage(err));
      setLoading(false);
    }
  }

  if (mfaToken) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
        <h1 className="text-xl font-semibold text-navy">Two-factor authentication</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          Enter the 6-digit code from your authenticator app. A one-time backup code also works.
        </p>
        <form onSubmit={onMfa} noValidate className="mt-5 space-y-4">
          {mfaError && <Alert tone="error">{mfaError}</Alert>}
          <Field label="Authentication code" required>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="123456"
              maxLength={12}
              autoFocus
            />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>
            Verify and sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          <button
            type="button"
            className="font-medium text-navy underline decoration-champagne underline-offset-4"
            onClick={() => {
              setMfaToken(null);
              setMfaCode("");
              setMfaError(null);
            }}
          >
            Use a different account
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-navy">Welcome back</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          Sign in to manage your vault and confirm your check-ins.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {justRegistered && !formError && (
          <Alert tone="info" title="Confirm your email first">
            We&apos;ve sent a confirmation link to {values.email || "your inbox"}. You can still
            sign in — unverified accounts can request a new link after signing in.
          </Alert>
        )}
        {formError && <Alert tone="error">{formError}</Alert>}

        <Field label="Email address" required error={errors.email}>
          <Input
            type="email"
            value={values.email}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
            autoComplete="email"
            invalid={Boolean(errors.email)}
            required
          />
        </Field>

        <Field label="Password" required error={errors.password}>
          <div className="relative">
            <Input
              type="password"
              value={values.password}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
              autoComplete="current-password"
              invalid={Boolean(errors.password)}
              required
              className="pr-24"
            />
          </div>
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-navy underline decoration-champagne underline-offset-4"
            >
              Forgot password?
            </Link>
          </div>
        </Field>

        <Checkbox
          label="Remember this device for 30 days"
          description="Only use this on a device you control."
          checked={rememberDevice}
          onChange={(e) => setRememberDevice(e.target.checked)}
        />

        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Sign in
        </Button>
      </form>

      <p className="mt-5 border-t border-line pt-4 text-center text-sm text-muted">
        New to AfterKey?{" "}
        <Link href="/signup" className="font-semibold text-navy underline decoration-champagne underline-offset-4">
          Create your vault
        </Link>
      </p>
    </div>
  );
}
