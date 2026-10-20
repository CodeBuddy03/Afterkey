import type { Metadata } from "next";
import { AdminSupportClient } from "./support-client";

export const metadata: Metadata = {
  title: "Admin · Support",
  robots: { index: false, follow: false },
};

export default function AdminSupportPage() {
  return <AdminSupportClient />;
}
