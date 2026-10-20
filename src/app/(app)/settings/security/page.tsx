import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { SecurityClient } from "./security-client";

export const metadata: Metadata = {
  title: "Security settings",
  robots: { index: false, follow: false },
};

export default async function SecuritySettingsPage() {
  await requireUserPage();
  return <SecurityClient />;
}
