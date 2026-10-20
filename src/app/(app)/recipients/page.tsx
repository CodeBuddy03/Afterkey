import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { RecipientsClient } from "./recipients-client";

export const metadata: Metadata = {
  title: "Trusted recipients",
  robots: { index: false, follow: false },
};

export default async function RecipientsPage() {
  await requireUserPage();
  return <RecipientsClient />;
}
