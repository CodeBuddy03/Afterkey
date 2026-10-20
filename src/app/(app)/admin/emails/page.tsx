import type { Metadata } from "next";
import { AdminEmailsClient } from "./emails-client";

export const metadata: Metadata = {
  title: "Admin · Email",
  robots: { index: false, follow: false },
};

export default function AdminEmailsPage() {
  return <AdminEmailsClient />;
}
