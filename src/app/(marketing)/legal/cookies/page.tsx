import type { Metadata } from "next";
import { LegalLayout } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Cookie preferences",
  description: "The exact cookies AfterKey sets, why each exists, and how to control them.",
  alternates: { canonical: "/legal/cookies" },
  robots: { index: true, follow: true },
};

const COOKIES = [
  {
    name: "ak_session",
    category: "Strictly necessary",
    purpose:
      "Keeps you signed in. httpOnly and same-site so page scripts can never read it; bound server-side to your device fingerprint.",
    duration: "Session (rolling, expires after inactivity)",
    removable: "Removing it signs you out.",
  },
  {
    name: "ak_csrf",
    category: "Strictly necessary",
    purpose: "Protects state-changing requests against cross-site request forgery.",
    duration: "Session",
    removable: "Removing it prevents forms from submitting.",
  },
  {
    name: "ak_consent",
    category: "Preferences",
    purpose: "Remembers choices you make on this page so we don't ask again every visit.",
    duration: "12 months",
    removable: "Safe to delete at any time.",
  },
];

const OPTIONAL: { title: string; body: string }[] = [
  {
    title: "No advertising cookies",
    body: "AfterKey sets no advertising, remarketing or cross-site tracking cookies anywhere — and none at all on vault or authentication pages.",
  },
  {
    title: "No third-party pixels",
    body: "There are no social media pixels or session-replay scripts on this site. Operational logging happens server-side.",
  },
  {
    title: "Analytics (optional, if ever enabled)",
    body: "If we add privacy-respecting, first-party analytics, they will be listed here and gated behind your consent before any script loads.",
  },
];

export default function CookiesPage() {
  return (
    <LegalLayout
      title="Cookie preferences"
      updated="19 October 2026"
      intro="Cookies here are few and functional. This page lists every cookie the product sets, what it does, and how long it lives."
      sections={[
        {
          id: "what-we-set",
          heading: "1. Cookies we set",
          body: (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line-dark text-xs uppercase tracking-wide text-muted">
                    <th scope="col" className="py-2 pr-4 font-semibold">Cookie</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Category</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Purpose</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Duration</th>
                    <th scope="col" className="py-2 font-semibold">If removed</th>
                  </tr>
                </thead>
                <tbody>
                  {COOKIES.map((c) => (
                    <tr key={c.name} className="border-b border-line align-top last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs text-navy">{c.name}</td>
                      <td className="py-3 pr-4 text-xs">{c.category}</td>
                      <td className="py-3 pr-4 leading-6 text-muted">{c.purpose}</td>
                      <td className="py-3 pr-4 text-xs text-muted">{c.duration}</td>
                      <td className="py-3 text-xs text-muted">{c.removable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          id: "not-used",
          heading: "2. What we deliberately don't use",
          body: (
            <>
              {OPTIONAL.map((item) => (
                <p key={item.title}>
                  <strong>{item.title}:</strong> {item.body}
                </p>
              ))}
            </>
          ),
        },
        {
          id: "control",
          heading: "3. How to control cookies",
          body: (
            <>
              <p>
                Strictly necessary cookies cannot be disabled while you are signed in — the
                product cannot function without them. You can always remove them via your browser,
                which simply signs you out.
              </p>
              <p>
                Preference cookies only remember choices made here; deleting them is safe and we
                will simply ask again. Browser-level controls (blocking all cookies, clearing on
                exit) work as expected with this site.
              </p>
            </>
          ),
        },
        {
          id: "changes",
          heading: "4. Changes and contact",
          body: (
            <p>
              Any new cookie will be listed on this page before it is used, with consent collected
              first where consent is required. Questions? Use the{" "}
              <a href="/contact">contact page</a>.
            </p>
          ),
        },
      ]}
    />
  );
}
