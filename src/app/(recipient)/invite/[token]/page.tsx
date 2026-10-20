import type { Metadata } from "next";
import { getAuthContext } from "@/lib/auth/guards";
import { InviteClient } from "./invite-client";

export const metadata: Metadata = {
  title: "You have been invited",
  robots: { index: false, follow: false },
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await getAuthContext();
  return <InviteClient token={token} signedInEmail={ctx?.user.email ?? null} />;
}
