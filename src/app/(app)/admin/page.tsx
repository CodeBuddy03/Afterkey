import type { Metadata } from "next";
import { AdminOverviewClient } from "./overview-client";

export const metadata: Metadata = {
  title: "Admin · Overview",
  robots: { index: false, follow: false },
};

export default function AdminOverviewPage() {
  return <AdminOverviewClient />;
}
