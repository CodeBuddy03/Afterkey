import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { DocumentsClient } from "./documents-client";

export const metadata: Metadata = {
  title: "Documents",
  robots: { index: false, follow: false },
};

export default async function DocumentsPage() {
  await requireUserPage();
  return <DocumentsClient />;
}
