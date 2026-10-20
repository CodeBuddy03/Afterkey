import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { MessagesClient } from "./messages-client";

export const metadata: Metadata = {
  title: "Legacy messages",
  robots: { index: false, follow: false },
};

export default async function MessagesPage() {
  await requireUserPage();
  return <MessagesClient />;
}
