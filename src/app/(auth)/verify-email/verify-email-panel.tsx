"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Alert, LoadingState } from "@/components/ui/feedback";

type State =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ok"; alreadyVerified: boolean }
  | { kind: "error"; message: string; retryable: boolean };

/**
 * Email verification landing page. Accepts ?token= and confirms it against
 * the API exactly like a real recipient clicking the emailed link.
 */
export function VerifyEmailPanel() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = React.useState<State>(token ? { kind: "working" } : { kind: "idle" });
  const [resending, setResending] = React.useState(false);
  const [resent, setResent] = React.useState<string | null>(null);

  const verify = React.useCallback(
    async (tok: string) => {
      setState({ kind: "working" });
      try {
        const res = await api.post<{ verified: boolean; alreadyVerified: boolean }>(
          "/api/auth/verify-email",
          { token: tok },
        );
        setState({ kind: "ok", alreadyVerified: Boolean(res.alreadyVerified) });
      } catch (err) {
        const message = errorMessage(err);
        setState({ kind: "error", message, retryable: true });
      }
    },
    [],
  );

  React.useEffect(() => {
    if (token) void verify(token);
  }, [token, verify]);

  async function resend() {
    setResending(true);
    setResent(null);
    try {
      await api.post("/api/auth/resend-verification", { token });
      setResent("If that link was expired, a fresh one is on its way.");
    } catch (err) {
      setResent(errorMessage(err));
    } finally {
      setResending(false);
    }
  }

  if (state.kind === "idle") {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="text-xl font-semibold text-navy">Confirmation link needed</h1>
        <Alert tone="warn" className="mt-3">
          Open the confirmation link in your email — this page was opened without one.
        </Alert>
        <div className="mt-5 flex flex-wrap gap-4 text-sm">
          <Link href="/signin" className="font-semibold text-navy underline decoration-champagne underline-offset-4">
            Sign in
          </Link>
          <Link href="/contact" className="text-muted underline underline-offset-4 hover:text-navy">
            Contact support
          </Link>
        </div>
      </div>
    );
  }

  if (state.kind === "working") {
    return <LoadingState label="Confirming your email…" />;
  }

  if (state.kind === "ok") {
    return (
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <h1 className="text-xl font-semibold text-navy">
          {state.alreadyVerified ? "Email already confirmed" : "Email confirmed"}
        </h1>
        <Alert tone="success" className="mt-3">
          {state.alreadyVerified
            ? "Your address was already confirmed — nothing else to do."
            : "Your address is confirmed. Your vault is fully active."}
        </Alert>
        <div className="mt-5">
          <Link href="/signin">
            <span className="inline-flex h-10 items-center justify-center cta-gradient rounded-lg px-4 text-sm font-semibold">
              Continue to sign in
            </span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      <h1 className="text-xl font-semibold text-navy">We couldn&apos;t confirm that link</h1>
      <Alert tone="error" className="mt-3" title="Link invalid or expired">
        {state.message}
      </Alert>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => verify(token)} disabled={!token}>
          Try the link again
        </Button>
        <Button onClick={resend} loading={resending} disabled={!token}>
          Send a new confirmation email
        </Button>
      </div>
      {resent && (
        <p className="mt-3 text-sm text-muted" role="status">
          {resent}
        </p>
      )}
      <p className="mt-4 text-sm text-muted">
        Still stuck?{" "}
        <Link href="/contact" className="font-medium text-navy underline decoration-champagne underline-offset-4">
          Contact support
        </Link>
      </p>
    </div>
  );
}
