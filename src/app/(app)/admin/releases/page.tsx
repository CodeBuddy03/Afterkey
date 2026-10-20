import type { Metadata } from "next";
import { AdminReleasesClient } from "./releases-client";

export const metadata: Metadata = {
  title: "Admin · Releases",
  robots: { index: false, follow: false },
};

export default function AdminReleasesPage() {
  return <AdminReleasesClient />;
}
