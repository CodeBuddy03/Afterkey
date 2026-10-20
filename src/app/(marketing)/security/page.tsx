import type { Metadata } from "next";
import { CtaBand, PageHero, Section, SectionHeading } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Security & privacy",
  description:
    "How AfterKey protects your data: encryption, Argon2id password hashing, session controls, server-side authorization, audit logging and admin restrictions.",
  alternates: { canonical: "/security" },
  robots: { index: true, follow: true },
};

const CONTROLS: { heading: string; items: { title: string; body: string }[] }[] = [
  {
    heading: "Data protection",
    items: [
      {
        title: "Encryption in transit",
        body: "All traffic is served over HTTPS/TLS. Cookies are httpOnly and same-site so tokens are not reachable from page scripts.",
      },
      {
        title: "Encryption at rest",
        body: "Vault content and uploads are sealed with envelope encryption (AES-256-GCM). Datastore fields that hold secrets are encrypted with keys from your environment — never committed to the repository.",
      },
      {
        title: "Password hashing",
        body: "Passwords are hashed with Argon2id (memory-hard, tuned parameters) and verified in constant time with a timing equalizer on sign-in.",
      },
      {
        title: "Recovery phrases",
        body: "Account recovery uses a BIP-39 style recovery phrase converted to a hardened key — we store only a hash of the derived key, never the phrase itself.",
      },
      {
        title: "Two-factor authentication",
        body: "TOTP-based 2FA (authenticator apps). Enabling it requires your password and a live code, and can be removed only with fresh re-authentication.",
      },
    ],
  },
  {
    heading: "Access control",
    items: [
      {
        title: "Server-side authorization",
        body: "Every API verifies the session, the same-origin header, and ownership of the resource on the server. Client checks are for convenience only.",
      },
      {
        title: "Device-bound sessions",
        body: "Sessions are bound to a device fingerprint, listed for you to review, and individually revocable. Password changes revoke other sessions.",
      },
      {
        title: "Re-authentication gates",
        body: "Sensitive operations — changing your password, editing recovery settings, altering release rules — require your password again within a short window.",
      },
      {
        title: "Rate limiting & lockouts",
        body: "Sign-in, password reset, verification and recovery endpoints are rate-limited per account and per IP, with uniform responses to prevent account enumeration.",
      },
      {
        title: "Recipient scoping",
        body: "Recipients can only read what you explicitly granted, checked per request against the release case state.",
      },
    ],
  },
  {
    heading: "Operational safeguards",
    items: [
      {
        title: "Tamper-evident audit log",
        body: "Security-relevant events — sign-ins, permission changes, check-ins, case transitions — are recorded with actor, IP, user agent and timestamp.",
      },
      {
        title: "Admin least privilege",
        body: "Administrators can manage accounts, cases and operations, but cannot browse your decrypted vault contents. Admin views show metadata, not secrets.",
      },
      {
        title: "Fail-closed release engine",
        body: "Release execution re-verifies case state, cancellation and recipient scope at the moment of disclosure. A stale job for a cancelled case cannot disclose anything.",
      },
      {
        title: "Real email delivery",
        body: "Notifications are sent through a real transactional provider with proper error handling — never a fake success, never a silent drop.",
      },
      {
        title: "No dark patterns",
        body: "No fabricated testimonials, fake countdowns, misleading badges or invented statistics anywhere in this product.",
      },
    ],
  },
];

export default function SecurityPage() {
  return (
    <>
      <PageHero
        eyebrow="Security & privacy"
        title="Security is the product, not a settings page"
        description="AfterKey holds information your family may one day depend on. Every control below is implemented in code and covered by tests — not a marketing promise."
      />

      <Section tone="white">
        <SectionHeading
          eyebrow="Principles"
          title="Five rules we design against"
          description="When convenience and security conflict, security wins — and we tell you why in plain language."
        />
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Least disclosure", "Share the minimum needed, for as long as needed, with exactly the people named."],
            ["Fail closed", "When a check cannot be completed, the safe answer is always “do not proceed”."],
            ["Explicit consent", "Nothing sensitive happens from an ambiguous state or an assumed yes."],
            ["Verifiable behavior", "Security claims are backed by automated tests that run in CI."],
            ["Honest reporting", "If something breaks, we say so — errors are visible, not swallowed."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-card border border-line bg-ivory-100/60 p-5">
              <h3 className="text-sm font-semibold text-navy">{title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {CONTROLS.map((group, i) => (
        <Section key={group.heading} tone={i % 2 === 0 ? "plain" : "white"}>
          <SectionHeading title={group.heading} align="left" />
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {group.items.map((item) => (
              <div key={item.title} className="rounded-card border border-line bg-surface p-5 shadow-card">
                <h3 className="text-base font-semibold text-navy">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </Section>
      ))}

      <Section tone="ivory">
        <SectionHeading
          eyebrow="Privacy"
          title="What we collect — and what we never will"
          align="center"
        />
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-card border border-line bg-surface p-5 shadow-card">
            <h3 className="text-sm font-semibold text-confirmed">We collect</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-charcoal">
              <li>Your name, email address and the timezone you choose.</li>
              <li>The records, documents and messages you deliberately put in your vault.</li>
              <li>Operational logs: IP address, user agent and timestamps for security events.</li>
              <li>Delivery status of emails we send you, so we can tell you if something failed.</li>
            </ul>
          </div>
          <div className="rounded-card border border-line bg-surface p-5 shadow-card">
            <h3 className="text-sm font-semibold text-danger">We never</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-charcoal">
              <li>Sell, rent or broker your data or your recipients' data.</li>
              <li>Use advertising trackers on vault or authentication pages.</li>
              <li>Read your decrypted vault contents as staff or administrators.</li>
              <li>Share content with a recipient you haven't explicitly granted.</li>
            </ul>
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-6 text-muted">
          Full detail lives in our <a href="/legal/privacy" className="font-medium text-navy underline decoration-champagne underline-offset-4">privacy policy</a>.
          Questions? <a href="/contact" className="font-medium text-navy underline decoration-champagne underline-offset-4">Contact us</a>.
        </p>
      </Section>

      <CtaBand
        title="See it for yourself"
        description="The fastest way to judge a security product is to use it. Create a vault and inspect the controls from the inside."
      />
    </>
  );
}
