import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { ModuleExplorer } from "@/components/vault/module-explorer";

export const metadata: Metadata = {
  title: "Digital accounts",
  robots: { index: false, follow: false },
};

const CATEGORIES = [
  ["email", "Email"],
  ["social", "Social media"],
  ["cloud", "Cloud storage"],
  ["domain", "Domain"],
  ["business", "Business"],
  ["subscription", "Subscription"],
  ["device", "Device"],
  ["crypto", "Crypto"],
  ["other", "Other"],
] as const;

const categoryLabel = (value: unknown) =>
  CATEGORIES.find(([v]) => v === value)?.[1] ?? String(value ?? "—");

export default async function DigitalPage() {
  await requireUserPage();
  return (
    <ModuleExplorer
      title="Digital accounts"
      description="The online accounts your family may need to recover, close or memorialise — with recovery instructions they can actually follow."
      endpoint="/api/digital"
      createLabel="Add account"
      emptyTitle="No digital accounts yet"
      emptyDescription="Add the accounts that would matter most if you were unreachable: primary email first — it unlocks everything else."
      searchable
      filter={{
        param: "category",
        label: "Filter by category",
        options: CATEGORIES.map(([value, label]) => ({ value, label })),
      }}
      fields={[
        { name: "category", label: "Category", type: "select", required: true, half: true, options: CATEGORIES.map(([value, label]) => ({ value, label })) },
        { name: "serviceName", label: "Service name", required: true, half: true, placeholder: "e.g. Gmail, iCloud, KRA portal" },
        { name: "username", label: "Username", half: true },
        { name: "accountEmail", label: "Account email", half: true, type: "email" },
        { name: "website", label: "Website", half: true, type: "url" },
        { name: "lastReviewedOn", label: "Last reviewed", type: "date", half: true },
        {
          name: "recoveryInstructions",
          label: "Recovery instructions",
          type: "textarea",
          description: "How your recipients should recover or close this account — official processes only, never your passwords. Encrypted.",
        },
        { name: "notes", label: "Private notes", type: "textarea", description: "Only you can read this. Do not store passwords here. Encrypted." },
      ]}
      columns={[
        { name: "serviceName", label: "Service" },
        { name: "category", label: "Category", render: (item) => categoryLabel(item.category) },
        { name: "username", label: "Username", render: (item) => (item.username ? String(item.username) : <span className="text-muted">—</span>) },
        {
          name: "recoveryInstructions",
          label: "Instructions",
          render: (item) =>
            item.recoveryInstructions ? (
              <Badgeish>Documented</Badgeish>
            ) : (
              <span className="text-muted">Missing</span>
            ),
        },
      ]}
    />
  );
}

function Badgeish({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-confirmed-50 bg-confirmed-50 px-2 py-0.5 text-xs font-medium text-confirmed-700">
      {children}
    </span>
  );
}
