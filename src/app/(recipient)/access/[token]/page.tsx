import type { Metadata } from "next";
import { AccessClient } from "./access-client";

export const metadata: Metadata = {
  title: "Content shared with you",
  robots: { index: false, follow: false },
};

export default async function AccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AccessClient token={token} />;
}
