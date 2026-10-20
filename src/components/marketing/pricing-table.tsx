"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import type { PlanView } from "@/lib/billing/plans";

/**
 * Pricing table (landing + /pricing). Prices come from the database
 * (migration 007), monthly and annual, with clear billing frequency, honest
 * annual totals, and derived savings — no fake discounts or countdowns.
 */

function formatMoney(cents: number, currency: string): string {
  const amount = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(amount);
}

function savingsPercent(monthlyCents: number, annualCents: number): number | null {
  if (monthlyCents <= 0 || annualCents <= 0) return null;
  const fullYear = monthlyCents * 12;
  if (annualCents >= fullYear) return null;
  return Math.round((1 - annualCents / fullYear) * 100);
}

export function PricingTable({ plans, className }: { plans: PlanView[]; className?: string }) {
  const [billing, setBilling] = React.useState<"monthly" | "annual">("annual");

  return (
    <div className={className}>
      <div role="radiogroup" aria-label="Billing period" className="mx-auto mb-10 flex w-fit items-center gap-1 rounded-full border border-line bg-surface p-1">
        {(["monthly", "annual"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={billing === mode}
            data-interactive
            onClick={() => setBilling(mode)}
            className={cn(
              "rounded-full px-5 py-2 text-sm font-medium transition-colors",
              billing === mode ? "cta-gradient text-ink" : "text-muted hover:text-navy",
            )}
          >
            {mode === "monthly" ? "Monthly" : "Annual"}
            {mode === "annual" && savingsPercent(plans[1]?.monthlyCents ?? 0, plans[1]?.annualCents ?? 0) !== null && (
              <span className="ml-1.5 text-xs font-semibold opacity-80">· Save up to {savingsPercent(plans[1]!.monthlyCents, plans[1]!.annualCents)}%</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map((plan) => {
          const annual = billing === "annual";
          const cents = annual ? plan.annualCents : plan.monthlyCents;
          const perMonth = annual ? Math.round(plan.annualCents / 12) : plan.monthlyCents;
          const save = savingsPercent(plan.monthlyCents, plan.annualCents);
          const isFree = plan.monthlyCents === 0 && plan.annualCents === 0;

          return (
            <div
              key={plan.slug}
              className={cn(
                "glass relative flex flex-col rounded-card p-6 shadow-card transition-colors",
                plan.highlight && "border-champagne/40 ring-1 ring-champagne/25",
              )}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-6 rounded-full border border-champagne/40 bg-champagne/15 px-3 py-0.5 text-xs font-semibold text-champagne-700">
                  Recommended
                </span>
              )}
              <h3 className="text-lg font-semibold text-navy">{plan.name}</h3>
              <p className="mt-1.5 min-h-[2.5rem] text-sm leading-6 text-muted">{plan.description}</p>

              <div className="mt-5">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold text-navy">{formatMoney(cents, plan.currency)}</span>
                  <span className="text-sm text-muted">
                    {isFree ? "forever" : annual ? "/year" : "/month"}
                  </span>
                </div>
                <p className="mt-1.5 min-h-[1.25rem] text-xs leading-5 text-muted">
                  {isFree
                    ? "No card required."
                    : annual
                      ? `≈ ${formatMoney(perMonth, plan.currency)}/month, billed annually (${formatMoney(plan.annualCents, plan.currency)} upfront).`
                      : "Billed monthly. Cancel anytime."}
                </p>
                {!isFree && annual && save !== null && (
                  <p className="mt-0.5 text-xs font-medium text-confirmed">
                    Annual saves {formatMoney(plan.monthlyCents * 12 - plan.annualCents, plan.currency)} a year.
                  </p>
                )}
              </div>

              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm leading-6 text-charcoal">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-champagne-600" aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href="/signup"
                className={cn(
                  "mt-7 inline-flex h-11 w-full items-center justify-center rounded-lg text-sm font-semibold transition-all",
                  plan.highlight
                    ? "cta-gradient shadow-sm hover:shadow-glow"
                    : "border border-line-dark bg-surface-2 text-navy hover:bg-white/10",
                )}
              >
                {isFree ? "Start free" : `Start with ${plan.name.split(" ")[1] ?? plan.name}`}
              </Link>
            </div>
          );
        })}
      </div>

      <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-5 text-muted">
        Prices are introductory and shown in {plans[0]?.currency ?? "USD"}. Annual plans are charged upfront once a
        year. Cancel anytime — your data stays yours. Recipients never pay a fee to receive an authorized release.
      </p>
    </div>
  );
}
