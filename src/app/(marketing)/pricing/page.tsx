import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand, PageHero, Section, SectionHeading } from "@/components/marketing/sections";
import { PricingTable } from "@/components/marketing/pricing-table";
import { getPublishedPlans, toPlanView } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Three AfterKey plans — Free, Plus and Family — with transparent monthly and annual pricing in USD.",
  alternates: { canonical: "/pricing" },
  robots: { index: true, follow: true },
};

const BILLING_NOTES = [
  {
    title: "Transparent billing",
    body: "Annual prices are charged once a year, upfront, and shown next to every price. No countdown timers, no hidden fees.",
  },
  {
    title: "Cancel anytime",
    body: "Cancelling keeps your data. The account simply returns to Free limits at the end of the paid period — nothing is deleted or locked away.",
  },
  {
    title: "Recipients never pay",
    body: "Someone receiving an authorized legacy release is never charged a fee to access what you planned for them.",
  },
];

export default async function PricingPage() {
  const plans = (await getPublishedPlans()).map(toPlanView);

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Plans that grow with your vault"
        description="Start free, upgrade when you need more room for records, recipients and family members."
      >
        <Link href="/signup" className="cta-gradient inline-flex h-11 items-center rounded-lg px-6 text-sm font-semibold shadow-sm transition-all hover:shadow-glow">
          Create Your Free Vault
        </Link>
      </PageHero>

      <Section>
        <PricingTable plans={plans} />
      </Section>

      <Section tone="ivory" className="border-t border-line">
        <SectionHeading
          eyebrow="Billing"
          title="Straightforward by design"
          description="The fine print, in plain language."
        />
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {BILLING_NOTES.map((note) => (
            <div key={note.title} className="glass rounded-card p-5 shadow-card">
              <h3 className="text-sm font-semibold text-navy">{note.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{note.body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-5 text-muted">
          Paid subscriptions activate when online billing goes live; the Free plan is fully functional today, and
          administrators can provision paid plans for early customers in the meantime. Questions?{" "}
          <Link href="/contact" className="text-champagne-600 underline underline-offset-4">
            Contact us
          </Link>
          .
        </p>
      </Section>

      <CtaBand />
    </>
  );
}
