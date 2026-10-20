import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { OnboardingClient } from "./onboarding-client";

export const metadata: Metadata = {
  title: "Set up your vault",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  await requireUserPage();
  return <OnboardingClient />;
}
