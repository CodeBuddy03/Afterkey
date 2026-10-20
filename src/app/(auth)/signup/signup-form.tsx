"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/inputs";
import { Alert } from "@/components/ui/feedback";

const POLICY = [
  "At least 10 characters",
  "One letter and one number",
  "Not a commonly used password",
];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Nairobi";
  } catch {
    return "Africa/Nairobi";
  }
}

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [values, setValues] = React.useState({
    fullName: "",
    email: "",
    password: "",
    timezone: detectTimezone(),
  });
  const [agreed, setAgreed] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  function upd(key: keyof typeof values) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setValues((v) => ({ ...v, [key]: e.target.value }));
      setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const localErrors: Record<string, string> = {};
    if (!values.email.trim()) localErrors.email = "Email is required.";
    if (!values.password) localErrors.password = "Choose a password.";
    else {
      const issues: string[] = [];
      if (values.password.length < 10) issues.push("Use at least 10 characters.");
      if (!/[a-zA-Z]/.test(values.password)) issues.push("Include at least one letter.");
      if (!/[0-9]/.test(values.password)) issues.push("Include at least one number.");
      if (issues.length) localErrors.password = issues.join(" ");
    }
    if (!agreed) localErrors.agree = "Please accept the terms and privacy policy to continue.";
    setErrors(localErrors);
    if (Object.keys(localErrors).length) return;

    setLoading(true);
    try {
      await api.post("/api/auth/register", {
        email: values.email.trim(),
        password: values.password,
        fullName: values.fullName.trim() || undefined,
        timezone: values.timezone,
      });
      setDone(true);
      // Land the user on the sign-in page with their email prefilled, then
      // back to wherever they came from (e.g. an invitation link).
      const next = searchParams.get("next");
      const nextQuery = next && next.startsWith("/") && !next.startsWith("//") ? `&next=${encodeURIComponent(next)}` : "";
      router.push(`/signin?email=${encodeURIComponent(values.email.trim())}&check=1${nextQuery}`);
    } catch (err) {
      setLoading(false);
      setErrors((prev) => ({ ...prev, ...fieldErrors(err) }));
      setFormError(errorMessage(err));
    }
  }

  if (done) {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="text-xl font-semibold text-navy">Check your inbox</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          If an account could be created for {values.email}, we&apos;ve sent a confirmation link
          that expires in 24 hours. Open it to activate your vault.
        </p>
        <div className="mt-5">
          <Link href="/signin" className="text-sm font-semibold text-navy underline decoration-champagne underline-offset-4">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-7">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-navy">Create your vault</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          Free to start. Organise the essentials in minutes — add the rest over time.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}

        <Field label="Full name" description="Used in your emails and on your dashboard." optionalHint error={errors.fullName}>
          <Input
            value={values.fullName}
            onChange={upd("fullName")}
            autoComplete="name"
            placeholder="Alex Mwangi"
            invalid={Boolean(errors.fullName)}
          />
        </Field>

        <Field label="Email address" description="We send check-in reminders and security notices here." required error={errors.email}>
          <Input
            type="email"
            value={values.email}
            onChange={upd("email")}
            autoComplete="email"
            placeholder="you@example.com"
            invalid={Boolean(errors.email)}
            required
          />
        </Field>

        <Field label="Password" description={POLICY.join(" · ")} required error={errors.password}>
          <Input
            type="password"
            value={values.password}
            onChange={upd("password")}
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            required
          />
        </Field>

        <input type="hidden" name="timezone" value={values.timezone} />

        <Checkbox
          label={
            <>
              I agree to the{" "}
              <Link href="/legal/terms" className="font-medium text-navy underline decoration-champagne underline-offset-4" target="_blank">
                terms of service
              </Link>{" "}
              and{" "}
              <Link href="/legal/privacy" className="font-medium text-navy underline decoration-champagne underline-offset-4" target="_blank">
                privacy policy
              </Link>
            </>
          }
          checked={agreed}
          onChange={(e) => {
            setAgreed(e.target.checked);
            if (e.target.checked) setErrors((prev) => ({ ...prev, agree: "" }));
          }}
          error={errors.agree}
        />

        <Button type="submit" className="w-full" size="lg" loading={loading}>
          Create your vault
        </Button>

        <p className="text-center text-xs leading-5 text-muted">
          Timezone detected: <strong className="font-medium">{values.timezone}</strong> — you can
          change it during onboarding.
        </p>
      </form>

      <p className="mt-5 border-t border-line pt-4 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/signin" className="font-semibold text-navy underline decoration-champagne underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
