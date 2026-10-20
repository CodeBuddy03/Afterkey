import type { Metadata } from "next";
import { Suspense } from "react";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create your vault",
  description: "Create a free AfterKey account and start organising the records, instructions and messages your people may need.",
  alternates: { canonical: "/signup" },
  robots: { index: true, follow: true },
};

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-card bg-white/60" aria-hidden="true" />}>
      <SignupForm />
    </Suspense>
  );
}
