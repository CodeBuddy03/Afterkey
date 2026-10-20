import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { PrivacyClient } from "./privacy-client";

export const metadata: Metadata = {
  title: "Privacy settings",
  robots: { index: false, follow: false },
};

export default async function PrivacySettingsPage() {
  const ctx = await requireUserPage();
  return <PrivacyClient deletionPending={ctx.user.status === "deletion_pending"} />;
}
