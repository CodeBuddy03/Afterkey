import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { ModuleExplorer } from "@/components/vault/module-explorer";

export const metadata: Metadata = {
  title: "Financial records",
  robots: { index: false, follow: false },
};

const CATEGORIES = [
  ["bank", "Bank"],
  ["credit_card", "Credit card"],
  ["savings", "Savings"],
  ["pension", "Pension"],
  ["investment", "Investment"],
  ["mortgage", "Mortgage"],
  ["loan", "Loan"],
  ["life_insurance", "Life insurance"],
  ["health_insurance", "Health insurance"],
  ["tax", "Tax"],
  ["business", "Business"],
  ["subscription", "Subscription"],
  ["other", "Other"],
] as const;

const categoryLabel = (value: unknown) =>
  CATEGORIES.find(([v]) => v === value)?.[1] ?? String(value ?? "—");

export default async function FinancialPage() {
  await requireUserPage();
  return (
    <ModuleExplorer
      title="Financial records"
      description="Banks, pensions, insurers and lenders — who to contact, what exists, and where the paperwork is. Sensitive notes are encrypted before storage."
      endpoint="/api/financial"
      createLabel="Add record"
      emptyTitle="No financial records yet"
      emptyDescription="Start with one: the bank your family would need to call first. You can add pensions, insurance policies and loans as you find them."
      searchable
      filter={{
        param: "category",
        label: "Filter by category",
        options: CATEGORIES.map(([value, label]) => ({ value, label })),
      }}
      fields={[
        { name: "category", label: "Category", type: "select", required: true, half: true, options: CATEGORIES.map(([value, label]) => ({ value, label })) },
        { name: "institution", label: "Institution", required: true, half: true, placeholder: "e.g. Barclays, NHIF, Britam" },
        { name: "nickname", label: "Nickname", half: true, placeholder: "e.g. Joint savings" },
        { name: "accountType", label: "Account type", half: true, placeholder: "e.g. Current account" },
        { name: "maskedIdentifier", label: "Account identifier (masked)", half: true, placeholder: "e.g. ••••4521", description: "Only the last digits — never store a full account number or PIN here." },
        { name: "referenceNumber", label: "Policy / reference number", half: true },
        { name: "providerPhone", label: "Provider phone", half: true, type: "tel" },
        { name: "providerUrl", label: "Provider website", half: true, type: "url" },
        { name: "namedContact", label: "Named contact", half: true, placeholder: "Adviser name if you have one" },
        { name: "openedOn", label: "Opened on", type: "date", half: true },
        { name: "maturityOn", label: "Maturity / renewal date", type: "date", half: true },
        { name: "lastReviewedOn", label: "Last reviewed", type: "date", half: true },
        {
          name: "claimInstructions",
          label: "Claim / contact instructions",
          type: "textarea",
          description: "What your recipients should actually do — who to call, what to say, which documents to present. Encrypted.",
        },
        { name: "notes", label: "Private notes", type: "textarea", description: "Only you can read this. Encrypted at rest." },
      ]}
      columns={[
        { name: "institution", label: "Institution" },
        { name: "category", label: "Category", render: (item) => categoryLabel(item.category) },
        { name: "maskedIdentifier", label: "Reference", render: (item) => (item.maskedIdentifier ? String(item.maskedIdentifier) : <span className="text-muted">—</span>) },
        { name: "referenceNumber", label: "Policy no.", render: (item) => (item.referenceNumber ? String(item.referenceNumber) : <span className="text-muted">—</span>) },
        { name: "maturityOn", label: "Renewal", render: (item) => (item.maturityOn ? String(item.maturityOn).slice(0, 10) : <span className="text-muted">—</span>) },
      ]}
    />
  );
}
