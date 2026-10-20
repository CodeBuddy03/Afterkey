import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { DashboardClient } from "./dashboard-client";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your vault overview: records, check-in status and open release cases.",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const ctx = await requireUserPage();
  return (
    <DashboardClient
      firstName={ctx.user.fullName?.split(" ")[0] ?? ctx.user.email.split("@")[0] ?? "there"}
      emailVerified={Boolean(ctx.user.emailVerifiedAt)}
    />
  );
}
