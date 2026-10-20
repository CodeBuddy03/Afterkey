import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand, PageHero, Section } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description:
    "Answers about how AfterKey works: check-ins, release cases, verification, encryption, recipients, cancellation and what happens to your data.",
  alternates: { canonical: "/faq" },
  robots: { index: true, follow: true },
};

const GROUPS = [
  {
    title: "The basics",
    items: [
      {
        q: "What exactly is AfterKey?",
        a: "A digital legacy platform: a private, encrypted vault for your important records and messages, a check-in schedule you keep, and a controlled process for sharing selected content with the people you trust — under conditions you define in advance.",
      },
      {
        q: "Is this a will or a legal service?",
        a: "No. AfterKey does not replace wills, executors, legal advice or official account recovery processes. It organises practical information and messages; formal estate documents still come from your legal advisers.",
      },
      {
        q: "Is AfterKey a bank or financial institution?",
        a: "No. We never hold money, move funds, or guarantee access to any financial institution. We help you record who to contact and what exists.",
      },
      {
        q: "Who can see my vault?",
        a: "Only you — plus exactly the recipients you explicitly grant, for exactly the content you assigned. Administrators operate the platform but cannot browse your decrypted vault contents.",
      },
    ],
  },
  {
    title: "Check-ins & release",
    items: [
      {
        q: "What is a check-in?",
        a: "A scheduled confirmation that you're OK — a one-click link in a reminder email, or a button in your dashboard. Confirming resets your clock immediately.",
      },
      {
        q: "What happens if I miss one?",
        a: "Reminders continue on the cadence you configured, escalating over your grace period. Missing a check-in does not share anything by itself — a release case only opens after your configured conditions are met.",
      },
      {
        q: "Can I cancel a release after it starts?",
        a: "Yes. Signing in and confirming you're OK cancels a pending case immediately. Cancellation is absolute: a cancelled case can never disclose content afterwards, including through any background job.",
      },
      {
        q: "What do recipients actually receive?",
        a: "Only the records and messages you selected for that case, and only for recipients you named — typically as a secure portal with expiring access, plus a notification email. They never receive your whole vault.",
      },
      {
        q: "What is the verification step?",
        a: "Before disclosure, recipients you designated may be asked to confirm their identity and acknowledge the request. You choose per case whether verification is required.",
      },
      {
        q: "Can content be released twice?",
        a: "Release execution is idempotent per case — each case discloses its scoped content at most once, and every transition is recorded in the audit log.",
      },
    ],
  },
  {
    title: "Security & data",
    items: [
      {
        q: "How is my data protected?",
        a: "Passwords are hashed with Argon2id; vault content and uploads are sealed with AES-256-GCM envelope encryption; sessions are httpOnly and device-bound; every security-sensitive action is authorized on the server and written to an audit log.",
      },
      {
        q: "Do you sell or scan my data?",
        a: "No. We don't sell, rent or broker data, and there are no advertising trackers on vault or auth pages. We collect only what a service like this operationally needs — described in our privacy policy.",
      },
      {
        q: "What if I forget my password?",
        a: "Use your recovery phrase (issued when you set up recovery) or the emailed reset flow, depending on what you configured. Recovery is deliberately hard to bypass — that's the point.",
      },
      {
        q: "Can I get my data out?",
        a: "Yes — a complete, readable JSON export of your account, generated on demand from your settings, delivered as a document in your own vault.",
      },
      {
        q: "How do I delete everything?",
        a: "Account deletion is available in settings with a 7-day grace period you can cancel by simply signing in. After completion, your records, documents and messages are removed.",
      },
    ],
  },
  {
    title: "Recipients & everyday use",
    items: [
      {
        q: "How do recipients join?",
        a: "They receive an invitation email, accept it, and create their own account with their own credentials. They never share your password, and you can revoke them at any time.",
      },
      {
        q: "Do recipients need to pay?",
        a: "Recipients don't need a paid plan to receive what you've shared. Invitations and acceptance are part of every plan.",
      },
      {
        q: "What does using it actually involve?",
        a: "A few minutes when you add or update a record, and seconds per check-in. That's the design goal — not another system demanding weekly attention.",
      },
      {
        q: "Does it work on phones?",
        a: "Yes. Every page — public site, dashboard, recipient portal and admin — is responsive, keyboard navigable and screen-reader friendly.",
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title="Straight answers to honest questions"
        description="If something here is still unclear, our help centre and contact page are one click away."
      />

      <Section tone="white">
        <div className="space-y-10">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h2 className="text-xl font-semibold text-navy">{group.title}</h2>
              <div className="mt-4 divide-y divide-line rounded-card border border-line bg-surface shadow-card">
                {group.items.map((item) => (
                  <details key={item.q} className="group p-5">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-semibold text-navy [&::-webkit-details-marker]:hidden">
                      <span>{item.q}</span>
                      <span
                        aria-hidden="true"
                        className="mt-0.5 text-muted transition-transform group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mt-2.5 text-sm leading-7 text-muted">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-muted">
          More detail in{" "}
          <Link href="/how-it-works" className="font-medium text-navy underline decoration-champagne underline-offset-4">
            how it works
          </Link>{" "}
          or the{" "}
          <Link href="/security" className="font-medium text-navy underline decoration-champagne underline-offset-4">
            security overview
          </Link>
          .
        </p>
      </Section>

      <CtaBand
        title="Still wondering something?"
        description="Ask us directly — a human reads every message."
        primary={{ href: "/contact", label: "Contact us" }}
        secondary={{ href: "/help", label: "Help centre" }}
      />
    </>
  );
}
