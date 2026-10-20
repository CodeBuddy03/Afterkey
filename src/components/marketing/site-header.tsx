"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { BrandLockup } from "@/components/brand/logo";

const NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
];

/** Marketing header: translucent glass bar, restrained blue-violet CTA, mobile drawer. */
export function SiteHeader() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => setOpen(false), [pathname]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="glass-strong sticky top-0 z-40 border-b border-line">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <BrandLockup onDark label="AfterKey — home" className="shrink-0" />

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm text-muted transition-colors",
                pathname?.startsWith(item.href)
                  ? "bg-white/[0.07] text-navy"
                  : "hover:bg-white/5 hover:text-navy",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2.5 sm:flex">
          <Link
            href="/signin"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-white/5 hover:text-navy"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="cta-gradient rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-all hover:shadow-glow"
          >
            Get started
          </Link>
        </div>

        <button
          type="button"
          className="ml-auto rounded-md p-2 text-muted hover:bg-white/10 hover:text-navy sm:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          data-interactive
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-line px-4 pb-4 pt-2 sm:px-6 lg:hidden">
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2.5 text-sm text-muted hover:bg-white/5 hover:text-navy"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              <Link href="/signin" className="rounded-lg border border-line-dark px-3 py-2.5 text-center text-sm font-medium text-navy">
                Sign in
              </Link>
              <Link href="/signup" className="cta-gradient rounded-lg px-3 py-2.5 text-center text-sm font-semibold">
                Get started
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
