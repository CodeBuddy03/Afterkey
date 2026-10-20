import { z } from "zod";
import { zLongText, zShortText } from "@/lib/validation/common";
import type { ModuleSpec } from "@/lib/vault/modules";

/**
 * Specs and validation schemas for the flat vault modules, kept OUT of
 * route.ts files so route modules export only HTTP handlers (Next.js
 * validates route exports).
 */

export const FINANCIAL_CATEGORIES = [
  "bank", "credit_card", "savings", "pension", "investment", "mortgage", "loan",
  "life_insurance", "health_insurance", "tax", "business", "subscription", "other",
] as const;

export const financialSpec: ModuleSpec = {
  table: "financial_records",
  encrypted: ["claimInstructions", "notes"],
  columns: [
    "id", "category", "institution", "nickname", "account_type", "masked_identifier",
    "provider_url", "provider_phone", "reference_number", "named_contact", "opened_on",
    "maturity_on", "claim_instructions", "notes", "last_reviewed_on", "created_at",
    "updated_at", "archived_at",
  ],
  searchColumn: "institution",
  writable: [
    "category", "institution", "nickname", "accountType", "maskedIdentifier",
    "providerUrl", "providerPhone", "referenceNumber", "namedContact", "openedOn",
    "maturityOn", "claimInstructions", "notes", "lastReviewedOn",
  ],
};

export const dateOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.")
  .nullable()
  .optional();

export const financialCreateSchema = z.object({
  category: z.enum(FINANCIAL_CATEGORIES),
  institution: zShortText(160),
  nickname: zShortText(160).optional(),
  accountType: zShortText(80).optional(),
  maskedIdentifier: zShortText(80).optional(),
  providerUrl: zShortText(300).optional(),
  providerPhone: zShortText(60).optional(),
  referenceNumber: zShortText(120).optional(),
  namedContact: zShortText(160).optional(),
  openedOn: dateOrNull,
  maturityOn: dateOrNull,
  claimInstructions: zLongText(4000).optional(),
  notes: zLongText(4000).optional(),
  lastReviewedOn: dateOrNull,
});

export const DIGITAL_CATEGORIES = [
  "email", "social", "cloud", "domain", "business", "subscription", "device", "crypto", "other",
] as const;

export const digitalSpec: ModuleSpec = {
  table: "digital_accounts",
  encrypted: ["recoveryInstructions", "notes"],
  columns: [
    "id", "category", "service_name", "username", "website", "account_email",
    "recovery_instructions", "notes", "last_reviewed_on", "created_at", "updated_at",
    "archived_at",
  ],
  searchColumn: "service_name",
  writable: [
    "category", "serviceName", "username", "website", "accountEmail",
    "recoveryInstructions", "notes", "lastReviewedOn",
  ],
};

export const digitalCreateSchema = z.object({
  category: z.enum(DIGITAL_CATEGORIES),
  serviceName: zShortText(160),
  username: zShortText(160).optional(),
  website: zShortText(300).optional(),
  accountEmail: z.string().trim().max(320).optional(),
  recoveryInstructions: zLongText(4000).optional(),
  notes: zLongText(4000).optional(),
  lastReviewedOn: dateOrNull,
});

export const PROPERTY_TYPES = [
  "primary", "rental", "land", "commercial", "holiday", "storage", "other",
] as const;

export const propertySpec: ModuleSpec = {
  table: "properties",
  encrypted: ["emergencyInstructions"],
  columns: [
    "id", "name", "property_type", "address_line", "city", "region", "postal_code",
    "country", "latitude", "longitude", "description", "ownership_reference",
    "emergency_instructions", "created_at", "updated_at", "archived_at",
  ],
  searchColumn: "name",
  filterColumn: "property_type",
  writable: [
    "name", "propertyType", "addressLine", "city", "region", "postalCode",
    "country", "latitude", "longitude", "description", "ownershipReference",
    "emergencyInstructions",
  ],
};

const latLng = z.number().min(-180).max(180).nullable().optional();

export const propertyCreateSchema = z.object({
  name: zShortText(200),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  addressLine: zShortText(300).optional(),
  city: zShortText(120).optional(),
  region: zShortText(120).optional(),
  postalCode: zShortText(40).optional(),
  country: zShortText(80).optional(),
  latitude: latLng,
  longitude: latLng,
  description: zLongText(4000).optional(),
  ownershipReference: zShortText(200).optional(),
  emergencyInstructions: zLongText(4000).optional(),
});
