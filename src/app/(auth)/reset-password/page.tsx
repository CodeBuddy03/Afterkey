import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Set a new password for your AfterKey account using your secure reset link.",
  alternates: { canonical: "/reset-password" },
  robots: { index: true, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-white/60" aria-hidden="true" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
