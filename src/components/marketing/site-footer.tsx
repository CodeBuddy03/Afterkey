import Link from "next/link";
import { BrandLockup } from "@/components/brand/logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/features", label: "Features" },
      { href: "/security", label: "Security & privacy" },
      { href: "/pricing", label: "Pricing" },
      { href: "/use-cases", label: "For families" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/help", label: "Help & support" },
      { href: "/faq", label: "FAQ" },
      { href: "/contact", label: "Contact us" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/signin", label: "Sign in" },
      { href: "/signup", label: "Get started" },
      { href: "/forgot-password", label: "Forgot password" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms of service" },
      { href: "/legal/privacy", label: "Privacy policy" },
      { href: "/legal/cookies", label: "Cookie preferences" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-ivory-100/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <BrandLockup onDark label="AfterKey — home" />
            <p className="mt-3 max-w-xs text-sm leading-6 text-muted">
              Your life. Your memories. Your legacy. Protected. Organize what matters today — and prepare the
              people you love for tomorrow.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-champagne-700">{col.title}</h3>
              <ul className="mt-3 space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-muted transition-colors hover:text-navy">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 border-t border-line pt-6 text-xs leading-6 text-muted/80">
          <p>
            AfterKey is not a bank and does not guarantee access to financial institutions. AfterKey does not
            independently establish anyone&apos;s death or incapacity, and does not replace wills, executors,
            legal advice, or official account recovery processes.
          </p>
          <p className="mt-3">© {new Date().getFullYear()} AfterKey. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
