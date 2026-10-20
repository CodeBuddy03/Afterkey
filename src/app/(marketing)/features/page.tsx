import type { Metadata } from "next";
import {
  FileLock2,
  Users,
  CalendarCheck,
  ScrollText,
  MapPin,
  FolderLock,
  ShieldCheck,
  BellRing,
  Download,
  Smartphone,
  Search,
  History,
} from "lucide-react";
import { CtaBand, PageHero, Section, SectionHeading } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Every module in AfterKey: encrypted records, documents, property map, legacy messages, recipients, check-ins, release controls, exports and audit history.",
  alternates: { canonical: "/features" },
  robots: { index: true, follow: true },
};

const FEATURES = [
  {
    icon: FolderLock,
    title: "Organised vault modules",
    body: "Financial records, digital accounts, property, documents, legacy messages and emergency instructions — each with fields that fit the content instead of one generic blob.",
  },
  {
    icon: FileLock2,
    title: "Private documents & media",
    body: "Upload PDFs, images and video. Files are encrypted at rest, virus-scanned when a scanner is configured, and served only through authorized, expiring URLs.",
  },
  {
    icon: MapPin,
    title: "Property & locations",
    body: "Record addresses, parcels and the physical places things are kept — safes, sheds, storage units — with notes your recipients can actually follow.",
  },
  {
    icon: Users,
    title: "Trusted recipients",
    body: "Invite people by email, scope what each receives, and see their invitation and acceptance state at a glance. Revocation is immediate.",
  },
  {
    icon: ScrollText,
    title: "Legacy messages",
    body: "Letters, wishes and instructions tied to specific recipients and release conditions. Add photos and videos to make them personal.",
  },
  {
    icon: CalendarCheck,
    title: "Flexible check-in schedules",
    body: "Pick the cadence and time in your own timezone. Weekly, monthly or custom — with daylight-saving and leap-year handling done properly.",
  },
  {
    icon: BellRing,
    title: "Tiered reminders",
    body: "Gentle nudges first, then firmer ones, then escalation contacts — all configurable, all delivered as real emails with one-click confirmation.",
  },
  {
    icon: ShieldCheck,
    title: "Release with guardrails",
    body: "A release case moves through explicit states: open, verifying, ready, executing, completed or cancelled — with fail-closed checks at execution time.",
  },
  {
    icon: History,
    title: "Full audit trail",
    body: "Sign-ins, permission changes, check-ins, case transitions and exports are recorded with actor, IP and timestamp. You can review your own history.",
  },
  {
    icon: Download,
    title: "Complete data export",
    body: "Download your entire account as a readable JSON bundle at any time — no support ticket, no waiting, no lock-in.",
  },
  {
    icon: Search,
    title: "Fast search & tags",
    body: "Find any record in seconds with search and tags across every module — because in a crisis, browsing isn't good enough.",
  },
  {
    icon: Smartphone,
    title: "Works on any device",
    body: "Responsive from phone to desktop, with a mobile-friendly check-in flow so confirming you're OK takes seconds from anywhere.",
  },
];

const NOT_INCLUDED = [
  "We are not a bank and cannot move money or access your accounts.",
  "We do not provide legal, tax or financial advice — speak to your adviser.",
  "We do not certify death or incapacity; that determination rests with authorities and professionals.",
  "We do not replace your will, executor or the official account-recovery processes of any provider.",
];

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Features"
        title="Everything in AfterKey — and nothing you don't need"
        description="A deliberate set of modules that cover the practical work of preparing your affairs, without turning into another cluttered app."
      />

      <Section tone="white">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-card border border-line bg-surface p-5 shadow-card transition-colors hover:border-navy-200"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-navy-50 text-navy">
                <f.icon size={20} aria-hidden="true" />
              </span>
              <h2 className="mt-3 text-base font-semibold text-navy">{f.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Honest scope"
          title="What AfterKey does not do"
          description="We would rather be clear now than disappointing later."
        />
        <ul className="mx-auto mt-6 max-w-2xl space-y-3">
          {NOT_INCLUDED.map((line) => (
            <li key={line} className="flex gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm leading-6 text-charcoal">
              <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-champagne" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Section>

      <CtaBand />
    </>
  );
}
