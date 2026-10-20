"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailCheck, UserPlus } from "lucide-react";
import { api, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter } from "@/components/ui/card";
import { Alert, LoadingState } from "@/components/ui/feedback";

interface InviteInfo {
  state: "pending" | "accepted" | "expired" | "revoked";
  email: string;
  recipientName: string;
  ownerName: string;
  expiresAt: string;
}

/**
 * Invitation acceptance for a trusted recipient. The raw token lives only in
 * the email; accepting links this account to the recipient row, and only the
 * invited address can accept — a forwarded link is not enough.
 */
export function InviteClient({ token, signedInEmail }: { token: string; signedInEmail: string | null }) {
  const router = useRouter();
  const [invite, setInvite] = React.useState<InviteInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [accepting, setAccepting] = React.useState(false);
  const [accepted, setAccepted] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await api.get<InviteInfo>(`/api/invite/${encodeURIComponent(token)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setInvite(res);
      } catch (err) {
        if (!controller.signal.aborted && !(err instanceof DOMException && err.name === "AbortError")) {
          setError(errorMessage(err));
        }
      }
    })();
    return () => controller.abort();
  }, [token]);

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      await api.post(`/api/invite/${encodeURIComponent(token)}`);
      setAccepted(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAccepting(false);
    }
  }

  if (!invite && !error) {
    return <LoadingState label="Checking your invitation…" />;
  }

  if (error && !invite) {
    return (
      <Card>
        <CardBody>
          <Alert tone="error" title="This link does not work">
            {error}
          </Alert>
        </CardBody>
      </Card>
    );
  }

  if (accepted) {
    return (
      <Card>
        <CardBody className="space-y-3 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-confirmed-50 text-confirmed">
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold text-navy">You are all set</h1>
          <p className="text-sm leading-6 text-muted">
            {invite?.ownerName ?? "Your contact"} has added you as a trusted recipient. Anything they share with you
            will appear in your account — and only what they explicitly grant.
          </p>
        </CardBody>
        <CardFooter className="justify-center">
          <Button onClick={() => router.push("/dashboard")}>Go to my dashboard</Button>
        </CardFooter>
      </Card>
    );
  }

  if (!invite) return null;

  if (invite.state !== "pending") {
    const copy: Record<string, { title: string; body: string }> = {
      accepted: {
        title: "Already accepted",
        body: "This invitation has already been used. If that was not you, ask your contact to withdraw it from their recipients page.",
      },
      expired: {
        title: "Invitation expired",
        body: "Invitations last 14 days. Ask your contact to send a fresh one.",
      },
      revoked: {
        title: "Invitation withdrawn",
        body: "Your contact withdrew this invitation. Nothing was shared with you.",
      },
    };
    const c = copy[invite.state] ?? { title: "Invitation unavailable", body: "This invitation can no longer be used." };
    return (
      <Card>
        <CardBody>
          <h1 className="text-lg font-semibold text-navy">{c.title}</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted">{c.body}</p>
        </CardBody>
      </Card>
    );
  }

  const emailMatches = signedInEmail?.toLowerCase() === invite.email.toLowerCase();

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-navy">
            {invite.ownerName} has invited you to AfterKey
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            AfterKey is where people keep the accounts, documents and messages their family would need if the worst
            happened. Being a trusted recipient means {invite.ownerName} may one day share specific items with you —
            nothing is shared today, and you will always see exactly what was shared and why.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-ivory-50 px-4 py-3 text-sm">
          <p>
            <span className="font-medium text-navy">Invited address:</span> {invite.email}
          </p>
          <p className="mt-1 text-xs text-muted">
            Expires {new Date(invite.expiresAt).toLocaleDateString()} · this link is personal to you.
          </p>
        </div>
        {error && (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        )}
        {!signedInEmail && (
          <Alert tone="info" title="One more step">
            Accept with the address this invitation was sent to. If you do not have an account yet, create one with
            that address first, then return here.
          </Alert>
        )}
        {signedInEmail && !emailMatches && (
          <Alert tone="warn" title="Wrong account">
            You are signed in as {signedInEmail}, but this invitation was sent to {invite.email}. Sign in with the
            invited address to accept.
          </Alert>
        )}
      </CardBody>
      <CardFooter>
        {!signedInEmail ? (
          <>
            <Link
              href={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}
              data-interactive
              className="inline-flex"
            >
              <Button>Sign in to accept</Button>
            </Link>
            <Link
              href={`/signup?next=${encodeURIComponent(`/invite/${token}`)}`}
              data-interactive
              className="inline-flex"
            >
              <Button variant="secondary">
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Create an account
              </Button>
            </Link>
          </>
        ) : (
          <Button onClick={accept} loading={accepting} disabled={!emailMatches}>
            Accept invitation
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
