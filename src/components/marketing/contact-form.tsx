"use client";

import * as React from "react";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/inputs";
import { Alert } from "@/components/ui/feedback";

/** Public contact form → POST /api/support (rate-limited, audited). */
export function ContactForm() {
  const [values, setValues] = React.useState({ name: "", email: "", subject: "", message: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [state, setState] = React.useState<"idle" | "sending" | "sent">("idle");
  const [sentId, setSentId] = React.useState<string | null>(null);

  function set(key: keyof typeof values) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValues((v) => ({ ...v, [key]: e.target.value }));
      setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setState("sending");
    try {
      const res = await api.post<{ id: string }>("/api/support", values);
      setSentId(res.id);
      setState("sent");
    } catch (err) {
      setState("idle");
      setErrors(fieldErrors(err));
      setFormError(errorMessage(err));
    }
  }

  if (state === "sent") {
    return (
      <Alert tone="success" title="Message received.">
        Thank you — we&apos;ve logged your request{sentId ? ` (reference ${sentId})` : ""} and
        we&apos;ll reply to {values.email} as soon as a human has read it, usually within one
        business day.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required error={errors.name}>
          <Input value={values.name} onChange={set("name")} autoComplete="name" invalid={Boolean(errors.name)} required />
        </Field>
        <Field label="Email address" description="We only use this to reply to you." required error={errors.email}>
          <Input
            type="email"
            value={values.email}
            onChange={set("email")}
            autoComplete="email"
            invalid={Boolean(errors.email)}
            required
          />
        </Field>
      </div>
      <Field label="Subject" required error={errors.subject}>
        <Input
          value={values.subject}
          onChange={set("subject")}
          placeholder="e.g. Question about release verification"
          invalid={Boolean(errors.subject)}
          required
        />
      </Field>
      <Field
        label="Message"
        description="Please don't include passwords, recovery phrases or other secrets — we will never ask for them."
        required
        error={errors.message}
      >
        <Textarea value={values.message} onChange={set("message")} invalid={Boolean(errors.message)} required />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={state === "sending"}>
          Send message
        </Button>
        <span className="text-xs text-muted">Typical reply: within 1 business day.</span>
      </div>
    </form>
  );
}
