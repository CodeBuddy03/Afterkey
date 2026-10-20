"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarCheck,
  FileText,
  KeyRound,
  LayoutDashboard,
  Landmark,
  LogOut,
  MapPin,
  Menu,
  Mail,
  Settings,
  ShieldCheck,
  Users,
  X,
  CircleAlert,
} from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { api } from "@/lib/api/client";
import { BrandLockup } from "@/components/brand/logo";

interface ShellUser {
  fullName: string | null;
  email: string;
  role: "user" | "admin";
  emailVerified: boolean;
  forcePasswordChange: boolean;
  status: string;
}

const GROUPS = [
  {
    label: "Your vault",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/financial", label: "Financial records", icon: Landmark },
      { href: "/digital", label: "Digital accounts", icon: KeyRound },
      { href: "/documents", label: "Documents", icon: FileText },
      { href: "/properties", label: "Properties", icon: MapPin },
      { href: "/messages", label: "Legacy messages", icon: Mail },
    ],
  },
  {
    label: "People & schedules",
    items: [
      { href: "/recipients", label: "Trusted recipients", icon: Users },
      { href: "/checkins", label: "Check-ins & release", icon: CalendarCheck },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/settings/security", label: "Security", icon: ShieldCheck },
    ],
  },
] as const;

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  React.useEffect(() => setMenuOpen(false), [pathname]);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post("/api/auth/logout");
    } finally {
      setSigningOut(false);
      router.push("/signin");
      router.refresh();
    }
  }

  const firstName = (user.fullName ?? user.email.split("@")[0] ?? "there").split(" ")[0];

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-line px-5">
        <BrandLockup onDark label="AfterKey dashboard" href="/dashboard" className="shrink-0" />
      </div>

      <nav aria-label="Vault sections" className="flex-1 overflow-y-auto px-3 py-4 scrollbar-subtle">
        {GROUPS.map((group) => (
          <div key={group.label} className="mb-5">
            <h2 className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {group.label}
            </h2>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                        active ? "bg-white/[0.08] text-navy shadow-sm" : "text-charcoal hover:bg-ivory-100 hover:text-navy",
                      )}
                    >
                      <Icon size={16} strokeWidth={2} className={active ? "text-champagne" : "text-muted"} aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {user.role === "admin" && (
          <div className="mb-5">
            <h2 className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Operations</h2>
            <Link
              href="/admin"
              className="flex items-center gap-2.5 rounded-lg border border-champagne/40 bg-champagne/10 px-2.5 py-2 text-sm font-medium text-champagne-700 hover:bg-champagne/20"
            >
              <ShieldCheck size={16} aria-hidden="true" />
              Administrator panel
            </Link>
          </div>
        )}
      </nav>

      <div className="border-t border-line px-4 py-4">
        <div className="mb-3 min-w-0">
          <p className="truncate text-sm font-semibold text-navy">{firstName}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          data-interactive
          className="flex w-full items-center gap-2 rounded-lg border border-line-dark px-3 py-2 text-sm font-medium text-charcoal transition-colors hover:bg-ivory-100 disabled:opacity-60"
        >
          <LogOut size={15} aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ivory">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-900/40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-[17rem] max-w-[85vw] bg-surface shadow-pop">
            <button
              type="button"
              className="absolute right-3 top-4 rounded-md p-1.5 text-muted hover:text-navy"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              data-interactive
            >
              <X size={18} />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-md p-2 text-navy hover:bg-ivory-100"
            aria-label="Open menu"
            data-interactive
          >
            <Menu size={20} />
          </button>
          <BrandLockup onDark label="AfterKey dashboard" href="/dashboard" wordmarkClassName="h-5" />
          <button
            type="button"
            onClick={signOut}
            className="ml-auto rounded-md p-2 text-muted hover:text-navy"
            aria-label="Sign out"
            data-interactive
          >
            <LogOut size={18} />
          </button>
        </div>

        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          {!user.emailVerified && (
            <NoticeBand tone="warn">
              Your email address is not confirmed yet. Verify it to invite recipients and configure release
              settings.{" "}
              <button
                type="button"
                data-interactive
                className="font-semibold underline underline-offset-2"
                onClick={async () => {
                  await api.post("/api/auth/resend-verification");
                  alert("If an account exists for this address, a new confirmation email has been sent.");
                }}
              >
                Send confirmation email again
              </button>
            </NoticeBand>
          )}
          {user.forcePasswordChange && (
            <NoticeBand tone="warn">
              You are using development or recovered credentials — set a new password in{" "}
              <Link href="/settings/security" className="font-semibold underline underline-offset-2">
                Security settings
              </Link>{" "}
              to continue normally.
            </NoticeBand>
          )}
          {user.status === "deletion_pending" && (
            <NoticeBand tone="error">
              This account is scheduled for deletion. You can cancel it in{" "}
              <Link href="/settings/privacy" className="font-semibold underline underline-offset-2">
                Privacy settings
              </Link>
              .
            </NoticeBand>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

function NoticeBand({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "mb-5 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm leading-6",
        tone === "warn" && "border-warn-50 bg-warn-50 text-warn-700",
        tone === "error" && "border-danger-50 bg-danger-50 text-danger-700",
      )}
    >
      <CircleAlert size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
