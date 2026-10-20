import type { Metadata } from "next";
import { AdminAuditClient } from "./audit-client";

export const metadata: Metadata = {
  title: "Admin · Audit log",
  robots: { index: false, follow: false },
};

export default function AdminAuditPage() {
  return <AdminAuditClient />;
}
