import { db, type Queryable } from "../db";

/**
 * Plans are data, not code: prices and features live in the `plans` table
 * (migration 007) so introductory pricing can be adjusted without a deploy.
 * Prices are stored in cents (monthly + annual) in USD for initial validation;
 * the currency column supports localized currencies later.
 */

export interface PlanRow {
  slug: string;
  name: string;
  description: string;
  features: string[];
  priceCents: number | null;
  priceCentsAnnual: number | null;
  currency: string | null;
  sortOrder: number;
}

/** Serializable plan data for client components (pricing table, settings). */
export interface PlanView {
  slug: string;
  name: string;
  description: string;
  features: string[];
  monthlyCents: number;
  annualCents: number;
  currency: string;
  highlight: boolean;
}

/** The conversion plan gets subtle emphasis (never aggressive preselection). */
const HIGHLIGHTED_SLUG = "personal";

export async function getPublishedPlans(exec: Queryable = db): Promise<PlanRow[]> {
  const rows = await exec.q<PlanRow>(
    `SELECT slug, name, description, features, price_cents, price_cents_annual, currency, sort_order
       FROM plans
      WHERE published = true
      ORDER BY sort_order, name`,
  );
  return rows.map((r) => ({
    ...r,
    features: Array.isArray(r.features) ? r.features : [],
  }));
}

export function toPlanView(row: PlanRow): PlanView {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    features: row.features,
    monthlyCents: row.priceCents ?? 0,
    annualCents: row.priceCentsAnnual ?? (row.priceCents ?? 0) * 12,
    currency: (row.currency ?? "USD").toUpperCase(),
    highlight: row.slug === HIGHLIGHTED_SLUG,
  };
}
