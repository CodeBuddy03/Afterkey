import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { CheckinsClient } from "./checkins-client";

export const metadata: Metadata = {
  title: "Check-ins & release",
  robots: { index: false, follow: false },
};

export default async function CheckinsPage() {
  await requireUserPage();
  return <CheckinsClient />;
}
