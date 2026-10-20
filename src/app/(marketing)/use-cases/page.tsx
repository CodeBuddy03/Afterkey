import type { Metadata } from "next";
import { CtaBand, PageHero, Section, SectionHeading } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "For families & legacy planning",
  description:
    "Real situations AfterKey helps with: unexpected deaths, missing insurance policies, digital account recovery, executor handover and preserving personal messages.",
  alternates: { canonical: "/use-cases" },
  robots: { index: true, follow: true },
};

const SCENARIOS = [
  {
    situation: "“We couldn't find the insurance policy.”",
    body: "After an unexpected death, families routinely lose weeks searching for policies they didn't know existed. With AfterKey, every policy has a record: the provider, the policy number, where the paperwork lives, and who to call first.",
    outcome: "The family starts with a list, not a search party.",
  },
  {
    situation: "“I didn't know which banks to contact.”",
    body: "A surviving partner often knows some accounts and misses others. A financial-records module turns scattered knowledge into a complete contact sheet — institutions, advisers, account types and notes.",
    outcome: "Nothing important is discovered months too late.",
  },
  {
    situation: "“The deed was in a box somewhere.”",
    body: "Property records, titles and storage locations are easy to lose track of. AfterKey keeps documents attached to the property record itself, plus physical locations — safe, drawer, storage unit — spelled out.",
    outcome: "Documents are found in minutes instead of months.",
  },
  {
    situation: "“Nobody could get into her email.”",
    body: "Digital accounts lock families out exactly when access matters. AfterKey stores account records and recovery instructions, and can direct a recipient to the right official recovery process for each provider.",
    outcome: "A guided path instead of dead ends.",
  },
  {
    situation: "“I wish I had something from him.”",
    body: "Letters, advice, family stories, a message for a wedding that hasn't happened yet — legacy messages hold the words families treasure most, released only under the conditions you set.",
    outcome: "The voice survives, deliberately preserved.",
  },
  {
    situation: "“The executor didn't know where to begin.”",
    body: "Executors face an inventory problem: what exists, where it is, who holds it. AfterKey's structured records give them a starting manifest they can work through methodically.",
    outcome: "An orderly process replaces guesswork.",
  },
];

const PERSONAS = [
  {
    title: "You manage a household",
    body: "You're the one who remembers the insurance renewal, the meter readings and the solicitor's name. AfterKey turns that mental load into something your partner can actually use.",
  },
  {
    title: "You're planning for ageing parents",
    body: "Help parents organise their records while they're still fully in control of who sees what — on their terms, in their own words.",
  },
  {
    title: "You're an executor or named contact",
    body: "If someone has named you as a recipient, you'll receive exactly what they chose to share, with context on what to do next.",
  },
  {
    title: "You're going it alone",
    body: "No dependants, no complexity — just a clean, private record of your affairs so that someday, whoever needs to act can.",
  },
];

export default function UseCasesPage() {
  return (
    <>
      <PageHero
        eyebrow="For families & legacy"
        title="The quiet work of being findable"
        description="AfterKey addresses the ordinary, painfully common problems families face when someone becomes unavailable — with preparation instead of panic."
      />

      <Section tone="white">
        <SectionHeading
          eyebrow="Real situations"
          title="Six moments this product exists for"
          description="Each of these is a story families tell again and again. None of them are unusual."
        />
        <div className="mt-8 space-y-5">
          {SCENARIOS.map((s) => (
            <article key={s.situation} className="rounded-card border border-line bg-ivory-100/50 p-5 sm:p-6">
              <h3 className="font-serif text-lg text-navy">{s.situation}</h3>
              <p className="mt-2 text-sm leading-7 text-charcoal">{s.body}</p>
              <p className="mt-3 text-sm font-medium text-confirmed">{s.outcome}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Who it's for"
          title="Different lives, same need"
        />
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {PERSONAS.map((p) => (
            <div key={p.title} className="rounded-card border border-line bg-surface p-5 shadow-card">
              <h3 className="text-base font-semibold text-navy">{p.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{p.body}</p>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-8 max-w-2xl rounded-lg border border-line bg-surface px-5 py-4 text-sm leading-6 text-muted">
          AfterKey is not a substitute for professional advice. A will, an executor, and legal
          counsel remain essential — AfterKey simply makes sure the practical information behind
          them is organised and findable.
        </div>
      </Section>

      <CtaBand
        title="Start with one record tonight"
        description="You don't have to finish your whole vault at once. The first insurance policy or bank list is already progress."
      />
    </>
  );
}
