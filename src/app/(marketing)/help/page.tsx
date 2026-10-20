import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarCheck,
  KeyRound,
  Users,
  ScrollText,
  Download,
  ShieldCheck,
} from "lucide-react";
import { PageHero, Section, CtaBand } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Help & support",
  description:
    "Guides for AfterKey: getting started, check-ins, recipients, release cases, account security, exports and getting help.",
  alternates: { canonical: "/help" },
  robots: { index: true, follow: true },
};

const GUIDES = [
  {
    icon: KeyRound,
    title: "Getting started",
    href: "#getting-started",
    body: "Create your vault, set your timezone and check-in schedule, and add your first three records.",
  },
  {
    icon: CalendarCheck,
    title: "Check-ins & reminders",
    href: "#checkins",
    body: "How confirmation works, what a missed check-in triggers, and how to reset the clock.",
  },
  {
    icon: Users,
    title: "Recipients & permissions",
    href: "#recipients",
    body: "Inviting people, scoping what each receives, and revoking access immediately.",
  },
  {
    icon: ScrollText,
    title: "Release cases",
    href: "#release",
    body: "The lifecycle from open to completed, verification steps, and how cancellation works.",
  },
  {
    icon: ShieldCheck,
    title: "Account security",
    href: "#security",
    body: "Passwords, two-factor authentication, recovery phrases and reviewing active sessions.",
  },
  {
    icon: Download,
    title: "Export & deletion",
    href: "#data",
    body: "Download everything as JSON, or delete your account with its 7-day grace period.",
  },
];

export default function HelpPage() {
  return (
    <>
      <PageHero
        eyebrow="Help centre"
        title="How to do the things that matter"
        description="Short, plain-language guides. Every section maps to a real screen in the product."
      >
        <Link
          href="/contact"
          className="inline-flex h-11 items-center justify-center cta-gradient rounded-lg px-5 text-sm font-semibold transition-all hover:shadow-glow"
        >
          Contact support
        </Link>
        <a
          href="/faq"
          className="inline-flex h-11 items-center justify-center rounded-lg border border-line-dark bg-surface px-5 text-sm font-semibold text-navy transition-colors hover:bg-ivory-100"
        >
          Read the FAQ
        </a>
      </PageHero>

      <Section tone="white">
        <nav aria-label="Guide topics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDES.map((g) => (
            <a
              key={g.title}
              href={g.href}
              className="rounded-card border border-line bg-surface p-5 shadow-card transition-colors hover:border-navy-200"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50 text-navy">
                <g.icon size={18} aria-hidden="true" />
              </span>
              <h2 className="mt-3 text-sm font-semibold text-navy">{g.title}</h2>
              <p className="mt-1.5 text-sm leading-6 text-muted">{g.body}</p>
            </a>
          ))}
        </nav>
      </Section>

      <Section>
        <div className="prose-basic mx-auto max-w-3xl">
          <section id="getting-started" className="scroll-mt-24">
            <h2>Getting started</h2>
            <ol>
              <li>
                Create your account at <Link href="/signup">sign up</Link> and confirm your email
                address from the link we send — check spam if it doesn&apos;t arrive within a few
                minutes.
              </li>
              <li>
                Complete onboarding: your name, timezone, and a check-in schedule (weekly and
                monthly are the common choices).
              </li>
              <li>
                Add three real records tonight — an insurance policy, a bank, and the location of
                your will. Progress beats completeness.
              </li>
              <li>Invite one trusted recipient when you're ready. You can change everything later.</li>
            </ol>
          </section>

          <section id="checkins" className="scroll-mt-24">
            <h2>Check-ins &amp; reminders</h2>
            <p>
              Your dashboard shows your next check-in due date. When a reminder email arrives, the
              “I'm OK” button confirms in one click — no sign-in needed for confirmation, because
              the link itself is a single-use signed token that expires.
            </p>
            <p>
              Miss a check-in and reminders continue on your configured cadence during your grace
              period. Missing check-ins alone never discloses anything: a release case opens only
              when your configured conditions are met.
            </p>
            <p>
              You can change your schedule, timezone and reminder times in{" "}
              <strong>Settings → Check-ins</strong>. Changes take effect on the next cycle.
            </p>
          </section>

          <section id="recipients" className="scroll-mt-24">
            <h2>Recipients &amp; permissions</h2>
            <p>
              Invite recipients with their email address, then assign content categories per person
              — for example “financial records and documents” for your spouse, “legacy messages”
              for your daughter.
            </p>
            <p>
              Recipients accept the invitation with their own account and credentials. Revoking a
              recipient ends their access immediately, including pending invitations, and is
              recorded in your audit log.
            </p>
          </section>

          <section id="release" className="scroll-mt-24">
            <h2>Release cases</h2>
            <p>
              A release case moves through explicit states: <strong>open → verifying → ready →
              executing → completed</strong>, with <strong>cancelled</strong> reachable from any
              pre-completion state. Each transition is checked on the server and written to the
              audit log.
            </p>
            <p>
              <strong>To cancel, sign in and confirm you're OK.</strong> Cancellation takes effect
              immediately, and the engine re-verifies case state at execution time — a cancelled
              case cannot disclose content through any stale job.
            </p>
          </section>

          <section id="security" className="scroll-mt-24">
            <h2>Account security</h2>
            <p>
              In <strong>Settings → Security</strong> you can change your password, enable
              two-factor authentication with an authenticator app, generate a recovery phrase, and
              review or revoke active sessions.
            </p>
            <p>
              Sensitive changes ask for your password again (re-authentication). We will never ask
              for your password, recovery phrase or one-time codes by email — anyone who does is
              impersonating us.
            </p>
          </section>

          <section id="data" className="scroll-mt-24">
            <h2>Export &amp; deletion</h2>
            <p>
              <strong>Settings → Privacy</strong> offers a complete JSON export of your account —
              records, documents metadata, messages and preferences — delivered as a document in
              your own vault.
            </p>
            <p>
              Account deletion has a 7-day grace period. Signing in during that window cancels the
              deletion. After it completes, your data is removed and the removal is audited.
            </p>
          </section>

          <section id="contact" className="scroll-mt-24">
            <h2>Still stuck?</h2>
            <p>
              Use the <Link href="/contact">contact form</Link> — include the email on your account
              and as much detail as you can. Never send passwords, recovery phrases or TOTP codes.
            </p>
          </section>
        </div>
      </Section>

      <CtaBand
        title="Need an answer right now?"
        description="The FAQ covers check-ins, release and data questions in under a minute."
        primary={{ href: "/faq", label: "Read the FAQ" }}
        secondary={{ href: "/contact", label: "Contact us" }}
      />
    </>
  );
}
