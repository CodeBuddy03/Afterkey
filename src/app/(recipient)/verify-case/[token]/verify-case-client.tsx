"use client";

import * as React from "react";
import { CalendarClock, Handshake, XCircle } from "lucide-react";
import { api, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter } from "@/components/ui/card";
import { Alert, LoadingState } from "@/components/ui/feedback";

interface CaseView {
  caseId: string;
  ownerName: string;
  method: string;
  openedAt: string;
}

/**
 * Trusted-contact verification. The contact was emailed a single-use link;
 * they attest for or against the owner being unavailable. Nothing is shared
 * here — the attestation only affects whether a release may proceed, and the
 * owner can still cancel at any time during the delay window.
 */
export function VerifyCaseClient({ token }: { token: string }) {
  const [view, setView] = React.useState<CaseView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [decision, setDecision] = React.useState<"confirm_unavailable" | "cannot_confirm" | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<"confirm_unavailable" | "cannot_confirm" | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await api.get<CaseView>(`/api/verify-case/${encodeURIComponent(token)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setView(res);
      } catch (err) {
        if (!controller.signal.aborted && !(err instanceof DOMException && err.name === "AbortError")) {
          setError(errorMessage(err));
        }
      }
    })();
    return () => controller.abort();
  }, [token]);

  async function submit(value: "confirm_unavailable" | "cannot_confirm") {
    setSubmitting(true);
    setDecision(value);
    setError(null);
    try {
      await api.post(`/api/verify-case/${encodeURIComponent(token)}`, { decision: value });
      setDone(value);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!view && !error) {
    return <LoadingState label="Checking this verification link…" />;
  }

  if (error && !view) {
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

  if (done) {
    return (
      <Card>
        <CardBody className="space-y-2 text-center">
          <span
            className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
              done === "confirm_unavailable" ? "bg-navy-50 text-navy" : "bg-ivory-100 text-muted"
            }`}
          >
            {done === "confirm_unavailable" ? (
              <Handshake className="h-6 w-6" aria-hidden="true" />
            ) : (
              <XCircle className="h-6 w-6" aria-hidden="true" />
            )}
          </span>
          <h1 className="text-xl font-semibold text-navy">Response recorded</h1>
          <p className="text-sm leading-6 text-muted">
            {done === "confirm_unavailable"
              ? "You confirmed they may be unavailable. A release may now proceed subject to its delay window — they can still cancel it, and you will not receive anything they did not explicitly grant to you."
              : "You could not confirm they are unavailable. The release will not proceed on your response alone; their check-in process continues as configured."}
          </p>
        </CardBody>
      </Card>
    );
  }

  if (!view) return null;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-navy">A safety check from AfterKey</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            {view.ownerName} listed you as someone who would know if they were suddenly unavailable. They have not
            checked in on schedule, and their release process has reached the point where their trusted contacts are
            asked to weigh in.
          </p>
        </div>
        <Alert tone="warn" title="Nothing has been shared">
          Answering does not give you access to anything. If a release proceeds, they chose in advance exactly what
          each recipient may receive. You can also simply not answer — no response means no release happens through
          your attestation.
        </Alert>
        <p className="text-sm leading-6 text-charcoal">
          Do you genuinely believe {view.ownerName} is unavailable and cannot respond? Only answer if you truly believe
          so — a false confirmation can trigger something they did not intend.
        </p>
        {error && (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        )}
      </CardBody>
      <CardFooter>
        <Button
          onClick={() => void submit("confirm_unavailable")}
          loading={submitting && decision === "confirm_unavailable"}
          disabled={submitting}
        >
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          Yes — I believe they are unavailable
        </Button>
        <Button
          variant="secondary"
          onClick={() => void submit("cannot_confirm")}
          loading={submitting && decision === "cannot_confirm"}
          disabled={submitting}
        >
          No — I cannot confirm that
        </Button>
      </CardFooter>
    </Card>
  );
}
