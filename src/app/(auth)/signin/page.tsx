import type { Metadata } from "next";
import { Suspense } from "react";
import { SigninForm } from "./signin-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your AfterKey vault to manage records, recipients and check-ins.",
  alternates: { canonical: "/signin" },
  robots: { index: true, follow: true },
};

export default function SigninPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-card bg-white/60" aria-hidden="true" />}>
      <SigninForm />
    </Suspense>
  );
}
