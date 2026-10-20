import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailPanel } from "./verify-email-panel";

export const metadata: Metadata = {
  title: "Confirm your email",
  description: "Confirm the email address on your AfterKey account.",
  alternates: { canonical: "/verify-email" },
  robots: { index: true, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-card bg-white/60" aria-hidden="true" />}>
      <VerifyEmailPanel />
    </Suspense>
  );
}
