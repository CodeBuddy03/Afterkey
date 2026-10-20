import type { Metadata } from "next";
import { AdminUsersClient } from "./users-client";

export const metadata: Metadata = {
  title: "Admin · Users",
  robots: { index: false, follow: false },
};

export default function AdminUsersPage() {
  return <AdminUsersClient />;
}
