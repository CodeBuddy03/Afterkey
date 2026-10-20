import type { Metadata } from "next";
import { AdminSystemClient } from "./system-client";

export const metadata: Metadata = {
  title: "Admin · System",
  robots: { index: false, follow: false },
};

export default function AdminSystemPage() {
  return <AdminSystemClient />;
}
