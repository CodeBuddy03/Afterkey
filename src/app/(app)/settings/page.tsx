import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  await requireUserPage();
  return <SettingsClient />;
}
