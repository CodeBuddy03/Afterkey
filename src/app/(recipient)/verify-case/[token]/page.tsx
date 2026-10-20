import type { Metadata } from "next";
import { VerifyCaseClient } from "./verify-case-client";

export const metadata: Metadata = {
  title: "Verify contact",
  robots: { index: false, follow: false },
};

export default async function VerifyCasePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VerifyCaseClient token={token} />;
}
