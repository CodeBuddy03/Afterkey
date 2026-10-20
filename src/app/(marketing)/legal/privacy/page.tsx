import type { Metadata } from "next";
import { LegalLayout } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What AfterKey collects, why we collect it, how it is protected, who it is shared with, and the rights you have over it.",
  alternates: { canonical: "/legal/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy policy"
      updated="19 October 2026"
      intro="AfterKey holds deeply personal information by design. This policy explains exactly what we collect, why, and what we will never do with it."
      sections={[
        {
          id: "summary",
          heading: "1. The short version",
          body: (
            <ul>
              <li>We collect your account details, the content you deliberately store, and security logs.</li>
              <li>We use that data to run the service you asked for — nothing else.</li>
              <li>We never sell, rent, or broker your data, and never use advertising trackers on vault or auth pages.</li>
              <li>Recipients only ever see what you explicitly granted them.</li>
              <li>You can export everything or delete everything at any time.</li>
            </ul>
          ),
        },
        {
          id: "collect",
          heading: "2. Information we collect",
          body: (
            <>
              <p>
                <strong>You provide:</strong> your name, email address, timezone, the records,
                documents and messages you add to your vault, recipient invitations you send, and
                messages you submit through our contact form.
              </p>
              <p>
                <strong>Collected automatically:</strong> IP address, user agent, and timestamps for
                sign-ins and other security events; basic service logs needed to operate and debug
                the application.
              </p>
              <p>
                <strong>From payment providers (when enabled):</strong> subscription status and
                limited billing metadata. We never see or store full card numbers.
              </p>
            </>
          ),
        },
        {
          id: "use",
          heading: "3. How we use it",
          body: (
            <ul>
              <li>To provide the vault, check-in reminders, release process and recipient access you configure.</li>
              <li>To secure your account: authentication, rate limiting, fraud prevention, audit records.</li>
              <li>To send transactional email: verification, reminders, security notices, delivery results.</li>
              <li>To support you when you contact us, and to respond to lawful requests.</li>
              <li>To improve reliability, using aggregated, non-content operational metrics.</li>
            </ul>
          ),
        },
        {
          id: "legal-basis",
          heading: "4. Legal bases (UK/EU users)",
          body: (
            <p>
              We process on the basis of contract performance (running the service you signed up
              for), legitimate interests (security, abuse prevention, service improvement), consent
              (where required, e.g. optional emails), and legal obligation. Where processing relies
              on consent, you may withdraw it at any time.
            </p>
          ),
        },
        {
          id: "sharing",
          heading: "5. When information is shared",
          body: (
            <>
              <p>
                <strong>With your recipients</strong> — only content you have explicitly granted,
                only when your configured conditions are met, audited on every disclosure.
              </p>
              <p>
                <strong>With service providers</strong> — hosting, database, object storage and
                transactional email, each bound by contracts limiting use to providing the service
                to us.
              </p>
              <p>
                <strong>When legally required</strong> — we may disclose where compelled by valid
                legal process; where possible we notify you first.
              </p>
              <p>
                <strong>Never</strong> — for advertising, sold, or shared for cross-context
                behavioral targeting.
              </p>
            </>
          ),
        },
        {
          id: "security",
          heading: "6. How it is protected",
          body: (
            <p>
              HTTPS in transit; httpOnly same-site session cookies; Argon2id password hashing;
              AES-256-GCM envelope encryption for vault content and uploads with keys held in
              environment-managed secrets; server-side authorization on every endpoint;
              device-bound sessions with re-authentication gates; and a tamper-evident audit log of
              security events. No system is perfectly secure, but these are the controls we operate
              and test.
            </p>
          ),
        },
        {
          id: "retention",
          heading: "7. Retention and deletion",
          body: (
            <p>
              Account data is kept while your account is active. Deleting your account starts a
              7-day cancellable grace period, after which records, documents, messages and
              session data are removed and the deletion is recorded in our audit logs. Security
              logs are retained for a limited period after deletion for fraud and abuse handling.
              Backups age out on a documented schedule.
            </p>
          ),
        },
        {
          id: "rights",
          heading: "8. Your rights",
          body: (
            <p>
              Depending on where you live, you may have rights to access, correct, delete, export,
              restrict or object to processing of your personal data, and to complain to a
              supervisory authority. Self-service export and deletion live in Settings → Privacy;
              other requests can be made through the <a href="/contact">contact page</a>. We
              respond within the timeframes the law requires.
            </p>
          ),
        },
        {
          id: "cookies",
          heading: "9. Cookies",
          body: (
            <p>
              We use strictly necessary cookies for sign-in sessions and security (same-site,
              httpOnly). We do not use advertising or cross-site tracking cookies. Optional
              preference cookies, if any, are described on the{" "}
              <a href="/legal/cookies">cookie preferences page</a>.
            </p>
          ),
        },
        {
          id: "children",
          heading: "10. Children",
          body: (
            <p>
              AfterKey is intended for adults and is not directed at children under 16. We do not
              knowingly collect children's data; contact us if you believe a child has created an
              account and we will remove it.
            </p>
          ),
        },
        {
          id: "transfers",
          heading: "11. International transfers",
          body: (
            <p>
              Data may be processed in countries other than your own, including the UK, EU and
              United States, depending on our infrastructure. Where personal data transfers
              outside the UK/EEA occur, we use approved safeguards such as standard contractual
              clauses.
            </p>
          ),
        },
        {
          id: "contact",
          heading: "12. Contact and changes",
          body: (
            <p>
              Privacy questions go through the <a href="/contact">contact page</a> with the subject
              “privacy”. We will notify you of material changes to this policy before they take
              effect. The date at the top shows when this version became current.
            </p>
          ),
        },
      ]}
    />
  );
}
