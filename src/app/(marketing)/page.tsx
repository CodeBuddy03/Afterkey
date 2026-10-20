import type { Metadata } from "next";
import Link from "next/link";
import {
  ShieldCheck,
  Users,
  CalendarCheck,
  FileLock2,
  HeartHandshake,
  ScrollText,
  MapPin,
  KeyRound,
  History,
  ArrowRight,
  Check,
} from "lucide-react";
import { CtaBand, Section, SectionHeading } from "@/components/marketing/sections";
import { PricingTable } from "@/components/marketing/pricing-table";
import { getPublishedPlans, toPlanView } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: { absolute: "AfterKey — Everything that matters. Ready for tomorrow." },
  description:
    "Secure your important records, preserve personal messages, and prepare the people you trust for what comes next.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

const STEPS = [
  {
    title: "Organize what matters.",
    body: "Securely collect important documents, asset references, memories, and instructions.",
  },
  {
    title: "Choose your trusted people.",
    body: "Decide who may receive particular information and under which circumstances.",
  },
  {
    title: "Plan for the future.",
    body: "Set check-ins, reminders, and a carefully controlled legacy release plan.",
  },
];

const BENEFITS = [
  {
    icon: FileLock2,
    title: "Important documents, one place",
    body: "Insurance, property, legal and financial records — organized, searchable and encrypted at rest.",
  },
  {
    icon: HeartHandshake,
    title: "Letters and recorded memories",
    body: "Write private letters and preserve photos and messages for the people who matter most.",
  },
  {
    icon: MapPin,
    title: "Asset and property information",
    body: "Keep property details, accounts and instructions where your family can find them when it counts.",
  },
  {
    icon: Users,
    title: "Trusted recipients, granular permissions",
    body: "Each recipient sees only what you selected — never your entire vault by default.",
  },
  {
    icon: CalendarCheck,
    title: "Configurable check-ins",
    body: "A daily to yearly rhythm that fits your life, with gentle reminders on your schedule.",
  },
  {
    icon: ScrollText,
    title: "Planned legacy releases",
    body: "Release specific information after verified, policy-approved processes — never an automatic guess.",
  },
  {
    icon: History,
    title: "Security activity and recovery",
    body: "Review account security events, manage devices, and configure recovery options you control.",
  },
];

const FAQS = [
  {
    q: "What happens if a subscription expires?",
    a: "Your data is never deleted or held hostage. If a paid subscription ends, the account returns to the Free plan limits and your vault stays readable — you can remove records or re-subscribe at any time.",
  },
  {
    q: "Can I cancel?",
    a: "Yes. Cancel anytime from your billing settings. Annual plans are charged upfront once a year; if you cancel, the plan stays active until the end of the paid period.",
  },
  {
    q: "Who can access my information?",
    a: "Only you, while you are active. After a verified legacy release, exactly the recipients and records you selected become accessible — each with an explicit permission set and expiring access.",
  },
  {
    q: "How are legacy releases verified?",
    a: "A missed check-in is never treated as proof of death or incapacity. Missing check-ins trigger reminders, a grace period, and then a verification workflow — email confirmation, trusted-contact thresholds, or evidence review — configured by you, before any release.",
  },
  {
    q: "Can I change my trusted recipients?",
    a: "Any time. Update permissions, replace recipients, or revoke access from your dashboard. Changes apply to future releases; an in-progress verified case follows the rules that were in effect when it was opened, and disputes are supported.",
  },
  {
    q: "How is my information protected?",
    a: "Every vault is encrypted at rest with a unique data key wrapped by the server master key, sessions are hashed and revocable, sign-ins can require two-factor authentication, and account activity is recorded in an append-only audit log. Read the details on our Security page.",
  },
];

export default async function LandingPage() {
  const plans = (await getPublishedPlans()).map(toPlanView);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="ambient relative overflow-hidden border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="relative z-10 animate-rise-in">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne-700">
              Your digital legacy, thoughtfully protected
            </p>
            <h1 className="mt-4 font-serif text-4xl font-semibold leading-[1.08] text-navy sm:text-5xl lg:text-6xl">
              Everything that matters.
              <br />
              Ready for tomorrow.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted">
              Secure your important records, preserve personal messages, and prepare the people you trust for what
              comes next.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="cta-gradient inline-flex h-12 items-center justify-center rounded-lg px-7 text-base font-semibold shadow-sm transition-all hover:shadow-glow"
              >
                Create Your Free Vault
              </Link>
              <Link
                href="/how-it-works"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-line-dark px-7 text-base font-medium text-navy transition-colors hover:bg-white/10"
              >
                Explore How It Works
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-muted">
              <ShieldCheck className="h-4 w-4 text-champagne-600" aria-hidden="true" />
              Private by design. Your legacy, your decisions.
            </p>
          </div>

          {/* Abstract glass composition: vault motif with document & memory cards. */}
          <div aria-hidden="true" className="relative hidden h-[420px] lg:block">
            <div className="glass absolute left-6 top-4 w-64 rounded-card p-5 shadow-card animate-fade-in-slow">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-champagne/15 text-champagne-600">
                  <FileLock2 className="h-4.5 w-4.5" size={18} />
                </span>
                <div>
                  <p className="text-xs font-semibold text-navy">Life insurance policy</p>
                  <p className="text-[11px] text-muted">Document · encrypted</p>
                </div>
              </div>
              <div className="mt-4 space-y-1.5">
                <div className="h-1.5 w-full rounded bg-white/[0.08]" />
                <div className="h-1.5 w-4/5 rounded bg-white/[0.06]" />
                <div className="h-1.5 w-3/5 rounded bg-white/[0.05]" />
              </div>
            </div>

            <div className="glass absolute right-2 top-32 w-56 rounded-card p-5 shadow-card animate-fade-in-slow [animation-delay:150ms]">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-champagne/15 text-champagne-600">
                  <HeartHandshake size={18} />
                </span>
                <div>
                  <p className="text-xs font-semibold text-navy">Letter for Amelia</p>
                  <p className="text-[11px] text-muted">Memory · sealed</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-muted">
                “When you read this, know that every plan we made was with love…”
              </p>
            </div>

            <div className="glass-strong absolute bottom-2 left-16 w-60 rounded-card p-5 shadow-pop animate-fade-in-slow [animation-delay:300ms]">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-champagne/15 text-champagne-600">
                  <KeyRound size={20} />
                </span>
                <span className="rounded-full border border-confirmed/30 bg-confirmed/10 px-2.5 py-1 text-[10px] font-semibold text-confirmed">
                  Vault protected
                </span>
              </div>
              <p className="mt-3 text-xs font-semibold text-navy">Your vault</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                Encrypted at rest · check-in due in 12 days · 3 trusted recipients
              </p>
            </div>

            <div className="absolute inset-0 -z-10 rounded-full bg-champagne/10 blur-3xl" />
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <Section>
        <SectionHeading
          eyebrow="How it works"
          title="Three quiet steps to being prepared"
          description="No forms to dread, no data rush. Start with a few essentials and add more over time, at your own pace."
        />
        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="glass rounded-card p-6 shadow-card">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-champagne/30 bg-champagne/15 text-sm font-semibold text-champagne-700">
                {i + 1}
              </span>
              <h3 className="mt-4 text-base font-semibold text-navy">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mx-auto mt-6 max-w-2xl rounded-card border border-line bg-surface px-5 py-4 text-center text-sm leading-6 text-muted">
          If you miss a check-in, AfterKey sends reminders and then starts a careful verification process — it never
          assumes the worst, and it never releases anything automatically.
        </p>
      </Section>

      {/* ── Benefits ─────────────────────────────────────────── */}
      <Section tone="ivory" className="border-y border-line">
        <SectionHeading
          eyebrow="What you can keep"
          title="A place for everything your people may need"
          description="Records, instructions and memories — organized so nothing important is lost to time."
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((b) => (
            <div key={b.title} className="glass rounded-card p-5 shadow-card transition-colors hover:border-champagne/30">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-champagne/15 text-champagne-600">
                <b.icon size={19} aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-navy">{b.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted">{b.body}</p>
            </div>
          ))}
          <div className="glass flex flex-col justify-center rounded-card border-champagne/30 p-5 shadow-card">
            <p className="text-sm font-semibold text-navy">Everything, protected by default</p>
            <ul className="mt-3 space-y-2">
              {["Encrypted at rest", "Append-only audit log", "Two-factor authentication"].map((t) => (
                <li key={t} className="flex items-center gap-2 text-sm text-muted">
                  <Check className="h-4 w-4 text-confirmed" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* ── Security ─────────────────────────────────────────── */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <SectionHeading
              align="left"
              eyebrow="Security"
              title="Your most personal information deserves serious protection"
              description="AfterKey encrypts vault content at rest with unique per-vault keys, protects accounts with hashed sessions and optional two-factor authentication, limits every recipient to explicitly granted permissions, and records account activity in an append-only audit log."
            />
            <p className="mt-4 text-sm leading-6 text-muted">
              We are honest about our model: AfterKey holds the keys needed to perform the releases you authorize, so
              it is not zero-knowledge. We document exactly what that means before you entrust us with anything.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/security"
                className="inline-flex h-11 items-center rounded-lg border border-line-dark bg-surface-2 px-5 text-sm font-semibold text-navy transition-colors hover:bg-white/10"
              >
                How we protect you
              </Link>
              <Link href="/legal/privacy" className="inline-flex h-11 items-center px-2 text-sm font-medium text-muted underline underline-offset-4 hover:text-navy">
                Privacy Policy
              </Link>
              <Link href="/legal/terms" className="inline-flex h-11 items-center px-2 text-sm font-medium text-muted underline underline-offset-4 hover:text-navy">
                Terms of Service
              </Link>
              <Link href="/help" className="inline-flex h-11 items-center px-2 text-sm font-medium text-muted underline underline-offset-4 hover:text-navy">
                Help
              </Link>
            </div>
          </div>
          <ul className="grid gap-4">
            {[
              { icon: ShieldCheck, t: "Encrypted at rest", d: "AES-256-GCM per-vault data keys, wrapped by the server master key." },
              { icon: KeyRound, t: "Strong authentication", d: "Argon2id password hashing, revocable sessions, optional TOTP two-factor." },
              { icon: Users, t: "Least privilege by default", d: "Recipients receive scoped, expiring access — never your whole vault." },
              { icon: History, t: "Append-only audit trail", d: "Security-relevant events are recorded where they cannot be quietly edited." },
            ].map((item) => (
              <li key={item.t} className="glass flex gap-4 rounded-card p-4 shadow-card">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-champagne/15 text-champagne-600">
                  <item.icon size={19} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-navy">{item.t}</p>
                  <p className="mt-0.5 text-sm leading-6 text-muted">{item.d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ── Pricing ──────────────────────────────────────────── */}
      <Section id="pricing" tone="ivory" className="border-y border-line">
        <SectionHeading
          eyebrow="Pricing"
          title="Simple, honest pricing"
          description="Start free, forever. Upgrade when your vault grows — no surprise fees, ever."
        />
        <PricingTable plans={plans} className="mt-10" />
      </Section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <Section>
        <SectionHeading eyebrow="Questions" title="Answers, before you ask" />
        <div className="mx-auto mt-10 max-w-3xl divide-y divide-line rounded-card border border-line bg-surface px-6">
          {FAQS.map((faq) => (
            <details key={faq.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-navy [&::-webkit-details-marker]:hidden">
                {faq.q}
                <span className="text-lg font-light text-muted transition-transform group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted">{faq.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <CtaBand
        title="Start with a free vault today."
        description="Organize what matters today. Prepare the people you love for tomorrow."
        primary={{ href: "/signup", label: "Create Your Free Vault" }}
        secondary={{ href: "/how-it-works", label: "See how it works" }}
      />
    </>
  );
}
