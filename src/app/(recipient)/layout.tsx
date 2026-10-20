import Link from "next/link";
import { BrandLockup } from "@/components/brand/logo";

/**
 * Public, token-gated pages for recipients: invitation acceptance, case
 * verification and delivery access. No session is required — the recipient may
 * not have an account — so this group never redirects to sign-in.
 */
export default function RecipientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ivory">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandLockup label="AfterKey — home" />
          <Link href="/help" className="text-sm font-medium text-muted hover:text-navy">
            Need help?
          </Link>
        </div>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-10 sm:px-6 sm:py-16">
        <div className="w-full max-w-xl">{children}</div>
      </main>
      <footer className="border-t border-line bg-surface py-5">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-muted sm:px-6">
          © {new Date().getFullYear()} AfterKey ·{" "}
          <Link href="/legal/terms" className="underline underline-offset-2 hover:text-navy">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-navy">
            Privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
