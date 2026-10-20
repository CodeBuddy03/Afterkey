import Link from "next/link";
import { requireAdminPage } from "@/lib/auth/guards";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/releases", label: "Releases" },
  { href: "/admin/emails", label: "Email" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/system", label: "System" },
] as const;

/**
 * Admin area: role-checked at the layout so every section inherits the guard.
 * Operations views only — nothing here can decrypt a user's vault content.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return (
    <div>
      <nav aria-label="Admin sections" className="mb-6 border-b border-line">
        <ul className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                data-interactive
                className="inline-block rounded-t-lg border-b-2 border-transparent px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:text-navy [&[aria-current=page]]:border-navy [&[aria-current=page]]:text-navy"
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}
