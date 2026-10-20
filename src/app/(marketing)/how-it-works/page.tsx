import type { Metadata } from "next";
import { CtaBand, PageHero, Section, SectionHeading, StepList } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "How AfterKey works",
  description:
    "A walkthrough of the AfterKey lifecycle: build your vault, invite recipients, keep check-ins, and control what happens if a release case ever opens.",
  alternates: { canonical: "/how-it-works" },
  robots: { index: true, follow: true },
};

const LIFECYCLE = [
  {
    title: "Check-in reminders",
    body: "Your chosen schedule sends a reminder email with a one-click “I'm OK” link. Miss it, and the cadence continues — you always know where you stand.",
  },
  {
    title: "Escalation window",
    body: "After the first missed check-in, reminders escalate over the grace period you configured. Each step is visible to you in advance.",
  },
  {
    title: "Verification step",
    body: "Before anything is disclosed, designated recipients may be asked to confirm identity and acknowledge the request. A case can also open with verification required or not, per your configuration.",
  },
  {
    title: "Content disclosure",
    body: "Only the records you selected for that case — and only for the recipients you named — are shared. Everything else in your vault stays sealed.",
  },
  {
    title: "Cancellation, always",
    body: "Signing in and confirming you're OK cancels a pending case immediately. Cancelled cases can never disclose content afterwards — not through a stale job, not ever.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="A calm, transparent process — from first entry to controlled release"
        description="AfterKey runs on one simple loop: you keep your vault current, you keep your check-ins, and everything else only happens under rules you set in advance."
      >
        <a
          href="#lifecycle"
          className="inline-flex h-11 items-center justify-center cta-gradient rounded-lg px-5 text-sm font-semibold transition-all hover:shadow-glow"
        >
          Follow the lifecycle
        </a>
      </PageHero>

      <Section tone="white">
        <SectionHeading
          eyebrow="Step 1"
          title="Build your vault"
          description="Start small and grow over time. Each module is designed for a specific kind of information, so nothing important gets lost in a single notes field."
        />
        <StepList
          steps={[
            { title: "Financial records", body: "Banks, pensions, insurers, lenders — who to contact, what exists, where the paperwork is." },
            { title: "Property & assets", body: "Homes, land, vehicles, safes and storage, with locations, notes and documents attached." },
            { title: "Digital accounts", body: "Important online accounts, recovery instructions and the people who may need access." },
            { title: "Documents", body: "Wills, deeds, policies and IDs stored privately, encrypted at rest, downloadable only by you." },
            { title: "Legacy messages", body: "Letters, wishes and instructions for specific people — released only under your rules." },
            { title: "Emergency instructions", body: "The immediate “first call” list: who does what in the first 48 hours." },
          ]}
        />
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Step 2"
          title="Choose your people and their permissions"
          description="Recipients are invited by email and scoped explicitly. There is no “shared with everyone” setting."
        />
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            { title: "Per-recipient scope", body: "Each recipient sees only the record categories and messages you assigned to them — enforced server-side." },
            { title: "Conditional access", body: "Some recipients only receive anything if a release case opens; others can be given standing limited access." },
            { title: "Revoke at any time", body: "Remove a recipient and their access ends immediately, including any pending invitations." },
          ].map((item) => (
            <div key={item.title} className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="text-base font-semibold text-navy">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="white" id="lifecycle">
        <SectionHeading
          eyebrow="Step 3"
          title="The check-in &amp; release lifecycle"
          description="Every transition below is a backend state machine with tests — the interface simply shows you where you are."
        />
        <ol className="mt-10 space-y-5">
          {LIFECYCLE.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-card border border-line bg-ivory-100/50 p-5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-champagne/30 bg-champagne/15 text-sm font-semibold text-champagne-700">
                {i + 1}
              </span>
              <div>
                <h3 className="text-base font-semibold text-navy">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 rounded-lg border border-warn-50 bg-warn-50 px-4 py-3 text-sm leading-6 text-warn-700">
          <strong className="font-semibold">Important:</strong> AfterKey does not independently
          establish anyone's death or incapacity. Release begins only after your configured
          check-ins have lapsed and any verification you required has been satisfied — and it
          stops the moment you sign in.
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Day to day"
          title="What you actually do week to week"
          description="Very little — that's the point."
        />
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {[
            { title: "Confirm you're OK", body: "One click from the reminder email, or from your dashboard. It resets the clock instantly." },
            { title: "Keep records fresh", body: "Update a policy, add a new account, attach a document when life changes." },
            { title: "Review your people", body: "A periodic glance at who can receive what — and whether that's still right." },
            { title: "Read your letters", body: "Legacy messages are yours to edit and preview until the moment they're released." },
          ].map((item) => (
            <div key={item.title} className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="text-base font-semibold text-navy">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand
        title="Ready to get organised?"
        description="Your first vault takes minutes. Everything else can wait for a quiet evening."
      />
    </>
  );
}
