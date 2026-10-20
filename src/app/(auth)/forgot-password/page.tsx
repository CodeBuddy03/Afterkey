import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a secure link to reset your AfterKey password.",
  alternates: { canonical: "/forgot-password" },
  robots: { index: true, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
