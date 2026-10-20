import type { Metadata } from "next";
import { RecoveryForm } from "./recovery-form";

export const metadata: Metadata = {
  title: "Account recovery",
  description: "Recover access to your AfterKey account using your 24-word recovery phrase.",
  alternates: { canonical: "/recovery" },
  robots: { index: true, follow: false },
};

export default function RecoveryPage() {
  return <RecoveryForm />;
}
