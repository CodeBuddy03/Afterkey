import type { Metadata } from "next";
import { requireUserPage } from "@/lib/auth/guards";
import { ModuleExplorer } from "@/components/vault/module-explorer";

export const metadata: Metadata = {
  title: "Properties",
  robots: { index: false, follow: false },
};

const TYPES = [
  ["primary", "Primary home"],
  ["rental", "Rental"],
  ["land", "Land"],
  ["commercial", "Commercial"],
  ["holiday", "Holiday home"],
  ["storage", "Storage"],
  ["other", "Other"],
] as const;

const typeLabel = (value: unknown) => TYPES.find(([v]) => v === value)?.[1] ?? String(value ?? "—");

export default async function PropertiesPage() {
  await requireUserPage();
  return (
    <ModuleExplorer
      title="Properties & locations"
      description="Homes, land, storage and the physical places important things are kept — with addresses and emergency instructions your recipients can follow."
      endpoint="/api/properties"
      createLabel="Add property"
      emptyTitle="No properties recorded"
      emptyDescription="Record where things are: your home, a storage unit, land. Include where the documents and keys live."
      searchable
      filter={{
        param: "type",
        label: "Filter by type",
        options: TYPES.map(([value, label]) => ({ value, label })),
      }}
      fields={[
        { name: "name", label: "Name", required: true, half: true, placeholder: "e.g. Family home, Ridgeways" },
        { name: "propertyType", label: "Type", type: "select", half: true, options: TYPES.map(([value, label]) => ({ value, label })) },
        { name: "addressLine", label: "Address line" },
        { name: "city", label: "City / town", half: true },
        { name: "region", label: "Region / state", half: true },
        { name: "postalCode", label: "Postal code", half: true },
        { name: "country", label: "Country", half: true },
        { name: "latitude", label: "Latitude", half: true, placeholder: "-1.2921" },
        { name: "longitude", label: "Longitude", half: true, placeholder: "36.8219" },
        { name: "ownershipReference", label: "Ownership / title reference", half: true, description: "Deed number, title reference or account — never full bank details." },
        { name: "description", label: "Description", type: "textarea" },
        {
          name: "emergencyInstructions",
          label: "Emergency instructions",
          type: "textarea",
          description: "Where keys are, who to call, what to do first. Encrypted for recipients only on release.",
        },
      ]}
      columns={[
        { name: "name", label: "Property" },
        { name: "propertyType", label: "Type", render: (item) => typeLabel(item.propertyType) },
        {
          name: "addressLine",
          label: "Location",
          render: (item) => {
            const parts = [item.addressLine, item.city, item.region, item.country]
              .filter(Boolean)
              .map(String);
            return parts.length ? parts.join(", ") : <span className="text-muted">—</span>;
          },
        },
        {
          name: "emergencyInstructions",
          label: "Instructions",
          render: (item) =>
            item.emergencyInstructions ? (
              <span className="inline-flex items-center rounded-full border border-confirmed-50 bg-confirmed-50 px-2 py-0.5 text-xs font-medium text-confirmed-700">
                Documented
              </span>
            ) : (
              <span className="text-muted">Missing</span>
            ),
        },
      ]}
    />
  );
}
